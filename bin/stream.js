'use strict';
var old_work_dir = process.cwd();
process.chdir(__dirname); //set dir of current file as working dir

//************************import module  *************************************************
var child_process = require('child_process'),
    fs = require('fs'),
    url = require('url'),
    querystring = require('querystring'),
    Path = require('path'),
    jsonFile = require('./node_modules/jsonFile.js'),
    logger = require('./node_modules/logger.js');

var conf = jsonFile.parse(process.argv[2] ? Path.resolve(old_work_dir, process.argv[2]) : './stream.json');
var log = logger.create(conf ? conf.log : null);
log('===================================pid:' + process.pid + '=======================================');
if (!conf) {
  log(jsonFile.getLastError(), {stderr: true});
  process.exit(1);
}
log('use configuration: ' + JSON.stringify(conf, null, '  '));

//************************global var  ****************************************************
var outputDirSlash = conf.outputDir + '/';
var DEFAULT_FPS = 4, MIN_FPS = 0.1, MAX_FPS = 40, MIN_FPS_PLAY_AIMG = 0.1, MAX_FPS_PLAY_AIMG = 100;
var UPLOAD_LOCAL_DIR = './android', ANDROID_WORK_DIR = '/data/local/tmp/sji-asc', ANDROID_ASC_LOG_PATH = '/data/local/tmp/sji-asc.log';
var MULTIPART_BOUNDARY = 'MULTIPART_BOUNDARY', MULTIPART_MIXED_REPLACE = 'multipart/x-mixed-replace;boundary=' + MULTIPART_BOUNDARY;
var CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = BUF_CR2.slice(0, 1);
var re_adbNewLineSeq = /\r?\r?\n$/; // CR LF or CR CR LF
var re_extName = /\.\w+$/;
var devMgr = {}; //key:device serial number, value:device info. See getOrCreateDevCtx()
var chkerr = ''; //for chkerrXxx() to save error info 
var htmlCache = {}; //key:filename
var status = { consumerMap: {}};
var childProcPidMap = {}; //key: pid
var re_filename = /^((.+)~(?:live|rec)_f(\d+(?:\.\d+)?)[^_]*_(\d{14}\.\d{3}(?:.\d+)?)\.(ajpg|apng))(?:\.(webm|mp4))?(?:[~-]frame(\d+)\.(jpg|png))?$/;
var allTypeDispNameMap = {apng: 'Animated PNG', ajpg: 'Animated JPG', webm: 'WebM', mp4: 'MP4', jpg: 'JPEG', png: 'PNG'};
var allTypeMimeMapForDownload = {apng: 'video/apng', ajpg: 'video/ajpg', webm: 'video/webm', mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png'}; //safari need jpeg instead of jpg
var allTypeMimeMapForPlay = {apng: MULTIPART_MIXED_REPLACE, ajpg: MULTIPART_MIXED_REPLACE, webm: 'video/webm', mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png'};
var allVideoTypeOrderMap = {webm: 1, mp4: 2, ajpg: 3, apng: 4};
var aimgTypeSet = {ajpg: 1, apng: 2}; //also as sort order
var imageTypeSet = {jpg: 1, png: 2}; //also as sort order
var aimgAndImageTypeAry = Object.keys(aimgTypeSet).concat(Object.keys(imageTypeSet));
var html5videoTypeAry = ['mp4', 'webm'];
var aimgDecoderMap = {}; //key: filename+'~'+playerId. value: aimgDecoder
var dynamicConfKeyList = ['ffmpegDebugLog', 'ffmpegStatistics', 'remoteLogAppend', 'logHttpReqDetail', 'reloadDevInfo', 'logImageDumpFile', 'logImageDecoderDetail', 'latestFramesToDump', 'forceUseFbFormat', 'logTouchCmdDetail'];
var re_repeatableHtmlBlock = /<!--repeatBegin-->\s*([^\0]*)\s*<!--repeatEnd-->/;

//************************common *********************************************************
function getOrCreateDevCtx(device/*device serial number*/) {
  if (!devMgr[device]) {
    devMgr[device] = {device: device, err: '', info: ''};
    updateWholeUI();
  }
  return devMgr[device];
}

function spawn(logHead, _path, args, on_close, options) {
  log(logHead + 'spawn ' + _path + ' with args: ' + JSON.stringify(args));
  options = options || {};
  options.stdio = options.stdio || ['ignore'/*stdin*/, 'pipe'/*stdout*/, 'pipe'/*stderr*/];

  var childProc = child_process.spawn(_path, args, options);
  if (childProc.pid > 0) {
    childProcPidMap[childProc.pid] = true;
    childProc.logHead = logHead + '[pid_' + childProc.pid + ']';
    log(childProc.logHead + 'spawned');
  } else {
    childProc.__processNotStarted = true;
    log(childProc.logHead + 'spawn failed');
  }

  childProc.once('error', function (err) {
    if (err.code === 'ENOENT') {
      var hasDir = containsDir(_path);
      var hint = hasDir ? '' : ', Please use full path or add the executable file\'s dir to `PATH` environment variable';
      err = 'Error ENOENT(file is not found' + (hasDir ? '' : ' in dir list defined by PATH environment variable') + '). File: ' + _path + hint;
      childProc.__processNotStarted = true;
    } else if (err.code === 'EACCES') {
      err = 'Error EACCES(file is not executable or you have no permission to execute). File: ' + _path;
      childProc.__processNotStarted = true;
    }
    childProc.__err = err;
    log(childProc.logHead + childProc.__err);
  });
  childProc.once('close', function (ret, signal) { //exited or failed to spawn
    log(childProc.logHead + 'exited: ' + (ret === null || ret === undefined ? '' : ret) + ' ' + (signal || ''));
    delete childProcPidMap[childProc.pid];
  });

  //if specified on_close callback, then wait process finished and get stdout,stderr output
  if (typeof(on_close) === 'function') {
    var stdoutBufAry = [];
    if (childProc.stdout) {
      childProc.stdout.on('data', function (buf) {
        stdoutBufAry.push(buf);
        if (options.noLogStdout === true) {
          if (!childProc.didOmitStdout) {
            childProc.didOmitStdout = true;
            log(childProc.logHead + 'stdout output... omitted');
          }
        } else {
          log(buf, {noNewLine: true, head: childProc.logHead});
        }
      });
    }
    var stderrBufAry = [];
    if (childProc.stderr) {
      childProc.stderr.on('data', function (buf) {
        stderrBufAry.push(buf);
        log(buf, {noNewLine: true, head: childProc.logHead});
      });
    }
    childProc.once('close', function (ret) { //exited or failed to spawn
      var stdout = Buffer.concat(stdoutBufAry).toString();
      stdoutBufAry = null;
      var stderr = Buffer.concat(stderrBufAry).toString();
      stderrBufAry = null;
      on_close(ret, stdout, stderr);
    });
  }
  else {
    if (childProc.stdout) {
      childProc.stdout.on('data', function (buf) {
        if (!childProc.didGetStdoutData) {
          childProc.didGetStdoutData = true;
          log(childProc.logHead + 'got stdout data first time. ' + buf.length + ' bytes');
        }
      });
      childProc.stdout.on('end', function () {
        log(childProc.logHead + 'stdout read end');
      });
    }
    if (childProc.stderr) {
      childProc.stderr.on('data', function (buf) {
        if (!childProc.didGetStderrData) {
          childProc.didGetStderrData = true;
          log(childProc.logHead + 'got stderr data first time. ' + buf.length + ' bytes');
        }
      });
    }
  }

  return childProc;
}

function stringifyError(err) {
  if (err.code === 'ENOENT') {
    return 'Error: ENOENT(not found)';
  } else if (err.code === 'EACCES') {
    return 'Error: EACCES(access denied)';
  } else if (err.code === 'EADDRINUSE') {
    return 'Error: EADDRINUSE(IP or port already in use)';
  } else {
    return err.toString().replace(/\r*\n$/, '');
  }
}

function toErrSentence(s) {
  if (!s) {
    return '';
  }
  s = s.replace(/\r*\n$/, '');
  if (s.match(/error/i)) {
    return s;
  }
  return 'error: ' + s;
}
function removeNullChar(s) {
  return !s ? '' : s.replace(/\0/g, '');
}

htmlEncode.metaCharMap = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
function htmlEncode(text) {
  return String(text).replace(/[^0-9a-zA-Z]/g, function (match) {
    return htmlEncode.metaCharMap[match] || ('&#' + match.charCodeAt(0).toString() + ';');
  });
}

function htmlIdEncode(text) {
  return text.replace(/[^0-9a-zA-Z]/g, function (match) {
    return ('_' + match.charCodeAt(0).toString(16) + '_');
  });
}

function uniqueNonEmptyArray(ary) {
  if (!Array.isArray(ary)) {
    return [ary];
  }
  var resultAry = [];
  ary.forEach(function (v) {
    if (v && resultAry.indexOf(v) < 0) {
      resultAry.push(v);
    }
  });
  return resultAry;
}

function forEachValueIn(mapOrArray, callback, extraParameterForCallback/*optional*/) {
  var _argLen = arguments.length;
  Object.keys(mapOrArray).forEach(function (k) {
    var v = mapOrArray[k];
    if (_argLen === 2) {
      callback(v, k, mapOrArray);
    } else {
      callback(v, extraParameterForCallback, k, mapOrArray);
    }
  });
}

function dpad2(d) {
  return (d < 10) ? '0' + d : d.toString();
}
function dpad3(d) {
  return (d < 10) ? '00' + d : (d < 100) ? '0' + d : d.toString();
}
function dpad4(d) {
  return (d < 10) ? '000' + d : (d < 100) ? '00' + d : (d < 1000) ? '0' + d : d.toString();
}

function getTimestamp() {
  var dt = new Date();
  if (dt.valueOf() === getTimestamp.dtMs) {
    getTimestamp.seq++;
  } else {
    getTimestamp.seq = 0;
    getTimestamp.dtMs = dt.valueOf();
  }
  getTimestamp.lastValue = dpad4(dt.getFullYear()) + dpad2(dt.getMonth() + 1) + dpad2(dt.getDate()) + dpad2(dt.getHours()) + dpad2(dt.getMinutes()) + dpad2(dt.getSeconds()) + '.' + dpad3(dt.getMilliseconds()) + (getTimestamp.seq ? '.' + getTimestamp.seq : '');
  return getTimestamp.lastValue;
}

function stringifyTimestamp(ts) {
  return ts.slice(0, 4) + '/' + ts.slice(4, 6) + '/' + ts.slice(6, 8) + ' ' + ts.slice(8, 10) + ':' + ts.slice(10, 12) + ':' + ts.slice(12, 14) + ts.slice(14);
}

function setchkerr(err) {
  chkerr = err;
  return chkerr;
}

function chkerrRequired(name, value /*candidateArray | candidateValue | candidateMinValue, candidateMaxValue*/) {
  var origDispName = name.replace(/`?(\w+)`?/, '`$1`'), canBeArray = (name = origDispName.replace(/\[\]/, '')) !== origDispName;

  if (arguments.length === 3) { //check against array
    if (value === undefined || (Array.isArray(arguments[2]) ? arguments[2] : [arguments[2]]).indexOf(value) < 0) {
      return setchkerr(name + ' must be in ' + JSON.stringify(arguments[2]));
    }
  } else if (arguments.length === 4) { //check against range
    if (value === undefined || !(value >= arguments[2] && value <= arguments[3])) { //do not use v < min || v > max due to NaN always cause false
      return setchkerr(name + ' must be in (' + arguments[2] + ' ~ ' + arguments[3] + ')');
    }
  } else { //check required only
    if (!value) {
      return setchkerr(name + ' must be specified');
    }
    if (Array.isArray(value)) { //check array type value
      if (canBeArray) {
        if (value.every(isEmpty)) {
          return setchkerr(name + ' must not be an empty array');
        }
      } else {
        return setchkerr(name + ' must not be duplicated');
      }
    }
  }
  return '';

  function isEmpty(el) {
    return !el && el !== 0;
  }
}

function chkerrOptional(name, value /*,arrayOrMinValue, maxValue*/) {
  return value ? chkerrRequired.apply(null, arguments) : '';
}

function write(res, dataStrOfBuf) {
  if (res.__isEnded || res.__isClosed) {
    return;
  }
  if (res.__bytesWritten === undefined) {
    log(res.logHead + 'start output......');
    res.__bytesWritten = 0;
  }
  res.__bytesWritten += dataStrOfBuf.length;

  res.write(dataStrOfBuf);

  if (res.filename) { //FileRecorder
    if (res.startTimeMs) {
      if (Date.now() - res.startTimeMs >= conf.maxRecordTimeSeconds * 1000) {
        endCaptureConsumer(res, 'recording time is too long (>= ' + conf.maxRecordTimeSeconds + ' seconds)');
      }
    } else {
      res.startTimeMs = Date.now();
    }
  }
}

function end(res, dataStrOfBuf) {
  if (res.__isEnded || res.__isClosed) { //__isClosed is used for case when prepareDeviceFile complete, it maybe call end(res,...) but maybe res have been closed by peer.
    return;
  }
  res.__isEnded = true;

  if (res.setHeader && !res.__bytesWritten && !res.headersSent) { //for unsent http response
    var type;
    if (!(type = res.getHeader('Content-Type')) || type.slice(0, 5) !== 'text/') {
      res.setHeader('Content-Type', 'text/plain'); //any way, change to text/* type
    }
    res.removeHeader('Content-Length');
    res.removeHeader('Content-Disposition');
    if (res.logHead) {
      if (dataStrOfBuf === undefined) {
        log(res.logHeadSimple + 'END:');
      } else {
        var s = String(dataStrOfBuf);
        if (type && type.slice(5) === 'html') {
          var match = s.match(/<title>.*<\/title>/);
          s = match ? match[0] : s;
          log(res.logHeadSimple + 'END: ...' + (s.length > 50 ? s.slice(0, 50) : s) + '...');
        } else {
          s = s.replace(/\n[ \t]*/g, ' ');
          log(res.logHeadSimple + 'END: ' + s);
        }
      }
    }
    res.end(dataStrOfBuf);
  }
  else { //other case should ignore dataStrOrBuf
    if (res.logHead) {
      if (res.setHeader) {
        log(res.logHeadSimple + 'END. total ' + (res.__bytesWritten || 0) + ' bytes written');
      } else {
        log(res.logHead + 'END. total ' + (res.__bytesWritten || 0) + ' bytes written');
      }
    }
    res.end();
  }
}

function isAnyIp(ip) {
  return !ip || ip === '0.0.0.0' || ip === '*' || ip === '::1' || ip === 'fe80::1';
}

function getFirstIp() {
  var niMap = require('os').networkInterfaces();
  var ip = '';
  Object.keys(niMap).some(function (name) {
    return niMap[name].some(function (addr) {
      if (!addr['internal'] && addr['family'] === 'IPv4') {
        ip = addr.address;
        return true;
      }
      return false;
    });
  });
  return ip || 'localhost';
}

function containsDir(filename) {
  return ((process.platform === 'win32') ? /\/\\/ : /\//).test(filename);
}

function searchInPath(filename) {
  if (process.platform === 'win32' && !re_extName.test(filename)) {
    filename += '.exe';
  }
  if (containsDir(filename)) {
    return Path.resolve(filename); //prepend working dir
  }
  process.env['PATH'].split(Path.delimiter).some(function (dir) {
    try {
      if (fs.existsSync(dir + '/' + filename)) {
        filename = dir + '/' + filename;
        return true;
      }
    } catch (err) {
    }
    return false;
  });
  return filename;
}

function logIf(condition, msg, opt) {
  return condition ? log(msg, opt) : null;
}

//****************************************************************************************

function checkAdb(on_complete) {
  log('[CheckAdb]Full path of "Android Debug Bridge" is "' + searchInPath(conf.adb) + '"');
  spawn('[CheckAdb]', conf.adb, ['version'], function/*on_close*/(ret, stdout, stderr) {
    if (ret !== 0 || stderr) {
      log('Failed to check "Android Debug Bridge". Please install it from http://developer.android.com/tools/sdk/tools-notes.html and add adb\'s dir into PATH env var or set full path of ffmpeg to stream.json conf.adb', {stderr: true});
      return process.exit(1);
    }
    return on_complete();
  });
}

function checkFfmpeg(on_complete) {
  if (!conf.ffmpeg) {
    on_complete();
    return;
  }
  log('[CheckFfmpeg]Full path of FFMPEG is "' + searchInPath(conf.ffmpeg) + '"');
  spawn('[CheckFfmpeg]', conf.ffmpeg, ['-version'], function/*on_close*/(ret, stdout, stderr) {
    if (ret !== 0 || stderr) {
      log('Failed to check FFMPEG (for this machine, not for Android device).' +
          ' You will not be able to convert recorded video to other format.' +
          ' Please install it from "http://www.ffmpeg.org/download.html" and add the ffmpeg\'s dir to PATH env var or set full path of ffmpeg to stream.json conf.ffmpeg', {stderr: true});
    } else {
      checkFfmpeg.success = true;
    }
    on_complete();
  });
}

function getAllDev(on_complete) {
  spawn('[GetAllDevices]', conf.adb, conf.adbOption.concat('devices'), function/*on_close*/(ret, stdout, stderr) {
    if (ret !== 0 || stderr) {
      return on_complete(toErrSentence(stderr) || 'unknown error: failed to get all connected devices', []);
    }
    var deviceList = [], parts;
    stdout.split('\n').slice(1/*from second line*/).forEach(function (lineStr) {
      if ((parts = lineStr.split('\t')).length > 1) {
        var device = parts[0];
        if (/[^?]/.test(device) && deviceList.indexOf(device) < 0) { //exclude SN such as ??????
          deviceList.push(device);
        }
      }
    });
    return on_complete('', deviceList);
  });
}

var ADB_GET_DEV_INFO_CMD_ARGS = [
  'getprop', 'ro.product.model;',
  'getprop', 'ro.build.version.incremental;',
  'getprop', 'ro.product.manufacturer;',
  'getprop', 'ro.build.version.release;',
  'getprop', 'ro.build.version.sdk;',
  'getprop', 'ro.product.cpu.abi;'
];
function getDevInfo(device, on_complete, timeoutMs, forceReloadDevInfo) {
  if (!forceReloadDevInfo && devMgr[device] && devMgr[device].info && !devMgr[device].err) {
    on_complete('', devMgr[device].info);
    return;
  }
  var childProc = spawn('[GetDevInfo]', conf.adb, conf.adbOption.concat('-s', device, 'shell', 'echo', '`', ADB_GET_DEV_INFO_CMD_ARGS, '`'), function/*on_close*/(ret, stdout, stderr) {
        var err;
        if (childProc.myTimer) {
          clearTimeout(childProc.myTimer);
          err = (ret === 0 && !stderr) ? '' : stderr ? toErrSentence(stderr) : 'unknown error: failed to get device info';
        } else {
          err = 'error: timeout when try to get device info';
        }
        var info = stdout.trim();
        var dev = getOrCreateDevCtx(device);
        if (dev.info !== info || dev.err !== err) {
          dev.info = info;
          dev.err = err;
          updateWholeUI();
        }
        on_complete(err, info);
      }
  );
  childProc.myTimer = setTimeout(function () {
    childProc.myTimer = null;
    if (childProc.pid > 0) {
      log(childProc.logHead + 'kill due to timeout');
      childProc.kill('SIGKILL');
    }
  }, timeoutMs);
}

function getAllDevInfo(on_complete, forceReloadDevInfo) {
  getAllDev(function/*on_complete*/(err, deviceList) {
    if (err) {
      on_complete(err, []);
      return;
    }
    var i = 0;
    (function get_next_device_info() {
      if (i < deviceList.length) {
        getDevInfo(deviceList[i], function/*on_complete*/() {
              i++;
              get_next_device_info();
            },
            1000/*timeoutMs*/, forceReloadDevInfo);
      } else {
        on_complete('', deviceList);
      }
    })();
  });
}

/*
 * upload all necessary files to android
 */
function prepareDeviceFile(device, on_complete) {
  if (devMgr[device] && devMgr[device].didPrepare && !devMgr[device].err) {
    on_complete();
    return;
  }
  spawn('[CheckDevice ' + device + ']', conf.adb, conf.adbOption.concat('-s', device, 'shell', 'echo', '`', ADB_GET_DEV_INFO_CMD_ARGS, 'echo', '====;', 'cat', ANDROID_WORK_DIR + '/version', '2>', '/dev/null', '`'), function/*on_close*/(ret, stdout, stderr) {
    var dev;
    var err = (ret === 0 && !stderr && stdout) ? '' : stderr ? toErrSentence(stderr) : 'unknown error: failed to get device info';
    if (err) {
      if ((dev = devMgr[device]) && dev.err !== err) {
        dev.err = err;
        updateWholeUI();
      }
      return on_complete(err);
    }
    var stdoutNoCRLF = stdout.replace(re_adbNewLineSeq, '');
    var parts = stdoutNoCRLF.split('====');
    var ver = parts[1].trim(); //get remote version file content
    var info = parts[0].trim(); //get device info

    dev = getOrCreateDevCtx(device);
    if (dev.info !== info || dev.err !== err) {
      dev.info = info;
      dev.err = err;
      updateWholeUI();
    }
    // BTW, detect new line sequence returned by adb, Usually CrCount=0 (means need not convert), But for Windows OS, at least=1
    dev.CrCount = (stdout.length - stdoutNoCRLF.length) - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/;

    //compare to local version
    if (ver === prepareDeviceFile.ver) {
      dev.didPrepare = true;
      return on_complete();
    }
    return spawn('[PushFileToDevice ' + device + ']', conf.adb, conf.adbOption.concat('-s', device, 'push', UPLOAD_LOCAL_DIR, ANDROID_WORK_DIR), function/*on_close*/(ret, stdout, stderr) {
      if (ret !== 0) {
        return on_complete(toErrSentence(stderr) || 'unknown error: failed to prepare device file');
      }
      return spawn('[UpdateFileOnDevice ' + device + ']', conf.adb, conf.adbOption.concat('-s', device, 'shell', 'chmod', '755', ANDROID_WORK_DIR + '/*', '&&', 'echo', prepareDeviceFile.ver, '>', ANDROID_WORK_DIR + '/version'), function/*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stdout || stderr) {
          return on_complete(toErrSentence(stderr) || 'unknown error: failed to finish preparing device file');
        }
        dev.didPrepare = true;
        return on_complete();
      });
    });
  });
}

function prepareTouchServer(dev) {
  if (dev.touchStatus !== undefined) {
    if (dev.touchStatus === 'OK') {
      __prepareTouchServer(dev);
    }
    return;
  }
  dev.touchStatus = 'preparing';
  spawn('[touch]', conf.adb, conf.adbOption.concat('-s', dev.device, 'shell', 'getevent -iS || getevent -pS'), function/*on_close*/(ret, stdout, stderr) {
    if (ret !== 0 || stderr) {
      dev.touchStatus = undefined;
      log('[touch]******** failed to run adb');
      return;
    }
    //add device 6: /dev/input/event8
    //  bus:      0018
    //  vendor    0000
    //  product   0000
    //  version   0000
    //  name:     "Touchscreen"
    //  location: "3-0048/input0"
    //  id:       ""
    //  version:  1.0.1
    //  events:
    //    ABS (0003): 002f  : value 9, min 0, max 9, fuzz 0, flat 0, resolution 0
    //                0030  : value 0, min 0, max 30, fuzz 0, flat 0, resolution 0     //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
    //                0032  : value 0, min 0, max 30, fuzz 0, flat 0, resolution 0     //ABS_MT_WIDTH_MAJOR 0x32 /* Major axis of approaching ellipse */
    //                0035  : value 0, min 0, max 719, fuzz 0, flat 0, resolution 0    //ABS_MT_POSITION_X  0x35 /* Center X ellipse position */
    //                0036  : value 0, min 0, max 1279, fuzz 0, flat 0, resolution 0   //ABS_MT_POSITION_Y  0x36 /* Center Y ellipse position */
    //                0039  : value 0, min 0, max 65535, fuzz 0, flat 0, resolution 0  //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
    //                003a  : value 0, min 0, max 255, fuzz 0, flat 0, resolution 0    //ABS_MT_PRESSURE    0x3a /* Pressure on contact area */
    //  input props:
    //    INPUT_PROP_DIRECT
    dev.touchModernStyle = stdout.indexOf('INPUT_PROP_DIRECT') >= 0;

    if (!stdout.split(/add device \d+: /).some(function (devInfo) {
      var match = {};
      if ((match['0030'] = devInfo.match(/\D*0030.*value.*min.*max\D*(\d+)/)) && //ABS_MT_TOUCH_MAJOR
          (match['0035'] = devInfo.match(/\D*0035.*value.*min.*max\D*(\d+)/)) && //ABS_MT_POSITION_X
          (match['0036'] = devInfo.match(/\D*0036.*value.*min.*max\D*(\d+)/)) && //ABS_MT_POSITION_Y
          (match['0039'] = devInfo.match(/\D*0039.*value.*min.*max\D*(\d+)/)) && //ABS_MT_TRACKING_ID
          true) {
        if ((dev.touchModernStyle && devInfo.indexOf('INPUT_PROP_DIRECT') >= 0) ||
            (!dev.touchModernStyle && !devInfo.match(/\n +name: +.*pen/))) {

          dev.w = Math.floor((Number(match['0035'][1]) + 1) / 2) * 2;
          dev.h = Math.floor((Number(match['0036'][1]) + 1) / 2) * 2;
          if (!dev.w || !dev.h) {
            log('[touch]******** strange: max_x=' + match['0035'][1] + ' max_y=' + match['0036'][1]);
          } else {
            dev.touchAvgContactSize = Math.max(Math.ceil(match['0030'][1] / 2), 1);
            dev.touchMaxTrackId = Number(match['0039'][1]);

            if ((match = devInfo.match(/\D*003a.*value.*min.*max\D*(\d+)/))) { //ABS_MT_PRESSURE
              dev.touchAvgPressure = Math.max(Math.ceil(match[1] / 2), 1);
            }
            if ((match = devInfo.match(/\D*0032.*value.*min.*max\D*(\d+)/))) { //ABS_MT_WIDTH_MAJOR
              dev.touchAvgFingerSize = Math.max(Math.ceil(match[1] / 2), 1);
            }
            if (devInfo.match(/\n +KEY.*:.*014a/)) { //BTN_TOUCH for sumsung devices
              dev.touchNeedBtnTouchEvent = true;
            }

            dev.touchDevPath = devInfo.match(/.*/)[0]; //get first line: /dev/input/eventN
            dev.touchStatus = 'OK';
            log('[touch]******** got input device: ' + dev.touchDevPath + ' w=' + dev.w + ' h=' + dev.h + ' touchModernStyle=' + dev.touchModernStyle + ' touchAvgContactSize=' + dev.touchAvgContactSize + ' touchAvgPressure=' + dev.touchAvgPressure + ' touchAvgFingerSize=' + dev.touchAvgFingerSize + ' touchNeedBtnTouchEvent=' + dev.touchNeedBtnTouchEvent + ' touchMaxTrackId=' + dev.touchMaxTrackId + ' ********');
            __prepareTouchServer(dev);
            return true;
          }
        }
      }
      return false;
    })) { //almost impossible
      dev.touchStatus = 'not found touch device';
      log('[touch]******** ' + dev.touchStatus);
    }
  });

  function __prepareTouchServer(dev) {
    if (!dev.touchShellStdin) {
      var childProc = spawn('[touch]', conf.adb, conf.adbOption.concat('-s', dev.device, 'shell'), null, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'ignore'/*stderr*/]});
      childProc.on('close', function () {
        dev.touchShellStdin = undefined;
      });
      childProc.stdin.on('error', function (err) {
        log("[touch]failed to write touchServer.stdin. Error: " + err);
      });
      dev.touchShellStdin = childProc.stdin;
    }
  }
}

function installApkOnce(dev) {
  if (!dev.didTryInstallApk) {
    dev.didTryInstallApk = true;
    spawn('[installApk]', conf.adb, conf.adbOption.concat('-s', dev.device, 'shell', 'pm install ' + ANDROID_WORK_DIR + '/ScreenOrientation.apk'));
  }
}

function chkerrCaptureParameter(q) {
  if (q.type === undefined && q.fps === undefined && q.scale === undefined && q.rotate === undefined) {
    //try to peek parameter of current live capture if not specified any parameter
    var provider;
    if (devMgr[q.device] && (provider = devMgr[q.device].liveStreamer)) {
      q.type = provider.type;
      q.fps = provider.fps;
      q.scale = provider.scale;
      q.rotate = provider.rotate;
    } else {
      return setchkerr('error: no any live capture available for reuse');
    }
  }
  if (chkerrRequired('type', q.type, aimgAndImageTypeAry) ||
      aimgTypeSet[q.type] && chkerrRequired('fps', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS) ||
      chkerrOptional('rotate(optional)', (q.rotate = Number(q.rotate)), [0, 90, 180, 270])) {
    return chkerr;
  }
  if (imageTypeSet[q.type]) {
    q.fps = 0;
  }
  var n, match;
  q.scale_origVal = q.scale;
  if (q.scale) {
    if (!isNaN((n = Number(q.scale)))) { //can convert to a valid number
      if (chkerrRequired('scale(optional) in number format', (q.scale = n), 0.1/*min*/, 1/*max*/)) {
        return chkerr;
      }
    } else { //treat as string format 9999x9999
      if (!(match = (q.scale = String(q.scale)).match(/^(\d{0,4}|(?:auto)?)x(\d{0,4}|(?:Auto)?)$/i))) {
        return setchkerr('scale(optional) in string format must be in pattern "9999x9999" or "9999xAuto" or "Autox9999"');
      }
      q.scale_w = Number(match[1]);
      q.scale_h = Number(match[2]);
      if (!q.scale_w && !q.scale_h) {
        q.scale = '';
      } else {
        q.scale = q.scale.replace(/Auto/ig, '');
      }
    }
  }
  q.scale = q.scale === 1 ? '' : q.scale ? q.scale : '';
  q.rotate = q.rotate || '';
  return '';
}

function stringifyFpsScaleRotate(q) {
  var fps_scale_rotate = '';
  if (q.fps) {
    fps_scale_rotate += 'f' + q.fps;
  }
  if (q.scale) {
    if (typeof(q.scale) === 'number') {
      fps_scale_rotate += 's' + q.scale;
    } else {
      if (q.scale_w) {
        fps_scale_rotate += 'w' + q.scale_w;
      }
      if (q.scale_h) {
        fps_scale_rotate += 'h' + q.scale_h;
      }
    }
  }
  if (q.rotate) {
    fps_scale_rotate += 'r' + q.rotate;
  }
  return fps_scale_rotate;
}

function makeFilenameByCaptureParameter(q, forRecord) { //should respect re_filename
  return querystring.escape(q.device) + '~' + (forRecord ? 'rec' : 'live') + '_' + stringifyFpsScaleRotate(q) + '_' + getTimestamp() + '.' + q.type;
}

/**
 * Capture screen, send result to output stream 'res'. Maybe multiple output stream share a single capture process.
 * Please call chkerrCaptureParameter before this function.
 * @param outputStream result stream (e.g. HTTP response or file stream)
 * @param q option, Must have been checked by !chkerrCaptureParameter(q)
 *  {
      device : device serial number
      type:    'apng', 'ajpg', 'png', 'jpg'
      fps:     [optional] rate for apng, ajpg. Must be in range MIN_FPS~MAX_FPS
      scale:   [optional] 0.1 - 1 or string in format 9999x9999 or 9999xAuto or Autox9999
      rotate:  [optional] 0, 90, 180, 270
    }
 * @param on_captureBeginOrFailed
 */
function capture(outputStream, q, on_captureBeginOrFailed) {
  var res = outputStream;
  prepareDeviceFile(q.device, function/*on_complete*/(err) {
    if (err) {
      end(res, err);
      if (on_captureBeginOrFailed) {
        on_captureBeginOrFailed(err);
      }
      return;
    }
    if (res.__isClosed) {
      if (on_captureBeginOrFailed) {
        on_captureBeginOrFailed('canceled');
      }
      return;
    }
    var dev = devMgr[q.device], provider;

    function createCaptureProvider() {
      createCaptureProvider.called = true;
      var provider = {consumerMap: {}, dev: dev, type: q.type, fps: q.fps, scale: q.scale, rotate: q.rotate,
        logHead: '[Capture ' + q.device + ' ' + q.type + ' ' + stringifyFpsScaleRotate(q) + ']'};
      if (aimgTypeSet[q.type]) {
        var origFilename = makeFilenameByCaptureParameter(q, false/*for live*/);
        provider.aimgDecoder = aimgCreateContext(origFilename, null);
      }
      return provider;
    }

    if (res.setHeader) {
      res.setHeader('Content-Type', allTypeMimeMapForPlay[q.type]);
    }

    if (imageTypeSet[q.type]) { //-------------------capture a single image ---------------------------------------
      //try to use a shared live capture
      if (dev.liveStreamer && dev.liveStreamer.aimgDecoder && dev.liveStreamer.aimgDecoder.lastImage &&
          dev.liveStreamer.type === 'a' + q.type && dev.liveStreamer.fps >= 4 &&
          dev.liveStreamer.scale === q.scale && dev.liveStreamer.rotate === q.rotate) {
        write(res, dev.liveStreamer.aimgDecoder.lastImage.data);
        end(res);
        if (on_captureBeginOrFailed) {
          on_captureBeginOrFailed();
        }
        return;
      }
      provider = createCaptureProvider(); //can not share, so create new capture process
    }
    else if (dev.liveStreamer) { //there is an existing capture running or preparing
      //share existing stream provider (Animated PNG,JPG)
      if (dev.liveStreamer.type === q.type && dev.liveStreamer.fps === q.fps &&
          dev.liveStreamer.scale === q.scale && dev.liveStreamer.rotate === q.rotate) {
        if (res.filename) { //stop other recording
          forEachValueIn(dev.liveStreamer.consumerMap, function (_res) {
            if (_res.filename) {
              endCaptureConsumer(_res, 'another recording is going to run');
            }
          });
        }
        provider = dev.liveStreamer || (dev.liveStreamer = createCaptureProvider());
      } else { //stop current and start new if current live capture is not reusable for me
        forEachValueIn(dev.liveStreamer.consumerMap, endCaptureConsumer, 'another incompatible live capture is going to run'/*this string is used by other code*/);
        provider = dev.liveStreamer = createCaptureProvider();
      }
    } else { //there is no existing capture running or preparing
      provider = dev.liveStreamer = createCaptureProvider();
    }

    /*
     * add consumer
     */
    res.captureProvider = provider;
    res.consumerId = getTimestamp();
    res.on_captureBeginOrFailed = on_captureBeginOrFailed;
    provider.consumerMap[res.consumerId] = res;
    res.logHead = res.logHead.slice(0, -1) + ' @ ' + provider.logHead.slice(1, -1) + ']';
    log(res.logHead + 'added capture consumer ' + res.consumerId);

    res.on('close', function () { //http connection is closed without normal end(res,...) or file is closed
      endCaptureConsumer(res, 'canceled'/*do not change this string*/);
    });

    if (!createCaptureProvider.called) {
      log(res.logHead + 'use existing capture process ' + (provider.pid ? 'pid_' + provider.pid : '?(still in preparing)'));
      if (on_captureBeginOrFailed && provider.didGetStdoutData) {
        on_captureBeginOrFailed();
        res.on_captureBeginOrFailed = null;
      }
    } else {
      var opt;
      if (!(opt = conf.ffmpegOption[q.device]) && dev.info) {
        Object.keys(conf.ffmpegOption).some(function (key) {
          if (dev.info.match(key)) {
            opt = conf.ffmpegOption[key];
            return true;
          }
          return false;
        });
      }
      opt = opt || {};
      opt.in = opt.in || '';
      opt.out = opt.out || '';

      var FFMPEG_PARAM = '';
      //------------------------now make global parameters------------------------
      if (conf.ffmpegStatistics !== true) {
        FFMPEG_PARAM += ' -nostats';
      }
      if (conf.ffmpegDebugLog === true) {
        FFMPEG_PARAM += ' -loglevel debug';
      }
      //------------------------now make input parameters------------------------
      FFMPEG_PARAM += ' -r ' + (q.fps || 1);
      FFMPEG_PARAM += ' ' + opt.in + ' -i -'; //"-i -" means read from stdin
      //------------------------now make output parameters------------------------
      var filter = '';
      if (q.scale) {
        if (typeof(q.scale) === 'number') {
          filter += ',scale=' + 'ceil(iw*' + q.scale + '/2)*2' + ':' + 'ceil(ih*' + q.scale + '/2)*2';
        } else {
          filter += ',scale=' + 'ceil(' + (q.scale_w || ('iw/ih*' + q.scale_h) ) + '/2)*2' + ':' + 'ceil(' + (q.scale_h || ('ih/iw*' + q.scale_w) ) + '/2)*2';
        }
      }
      if (q.rotate) {
        if (q.rotate === 90) {
          filter += ',transpose=1';
        } else if (q.rotate === 180) {
          filter += ',transpose=1,transpose=1';
        } else if (q.rotate === 270) {
          filter += ',transpose=2';
        }
      }

      if (filter) {
        FFMPEG_PARAM += ' -vf ' + filter.slice(1/*remove first comma*/);
      }

      if (q.type === 'ajpg') { //animated jpg image
        FFMPEG_PARAM += ' -f image2 -vcodec mjpeg -update 1 -q:v 1';
      } else if (q.type === 'apng') { //animated png image
        FFMPEG_PARAM += ' -f image2 -vcodec png -update 1';
      } else if (q.type === 'jpg') {    //single jpg image
        FFMPEG_PARAM += ' -f image2 -vcodec mjpeg -vframes 1 -q:v 1';
      } else if (q.type === 'png') {    //single png image
        FFMPEG_PARAM += ' -f image2 -vcodec png -vframes 1';
      } else {
        log('unknown type');
      }
      FFMPEG_PARAM += ' ' + opt.out + ' -'; //means output to stdout
      /*
       * ------------------------------------start new capture process ---------------------------------------------
       */
      var childProc = spawn(provider.logHead, conf.adb, conf.adbOption.concat('-s', q.device, 'shell', 'cd', ANDROID_WORK_DIR, ';',
          'sh', './capture.sh',
          conf.forceUseFbFormat ? 'forceUseFbFormat' : 'autoDetectFormat',
          q.fps, FFMPEG_PARAM,
          (conf.remoteLogAppend ? '2>>' : '2>'), ANDROID_ASC_LOG_PATH));

      provider.pid = childProc.pid;
      childProc.stdout.on('data', function (buf) {
        if (!provider.didGetStdoutData) {
          provider.didGetStdoutData = true;
          forEachValueIn(provider.consumerMap, function (res) {
            if (res.on_captureBeginOrFailed) {
              res.on_captureBeginOrFailed(); //notify caller of capture() just once
              res.on_captureBeginOrFailed = null;
            }
          });
        }
        convertCRLFToLF(provider/*context*/, dev.CrCount, buf).forEach(function (buf) {
          if (aimgTypeSet[provider.type]) { //broadcast animated image to multiple client
            aimgDecode(provider.aimgDecoder, provider.consumerMap, buf, 0, buf.length);
          } else {
            forEachValueIn(provider.consumerMap, write, buf);
          }
        });
        provider.didOutput = true;
      });
      childProc.stderr.on('data', function (buf) {
        log(buf, {noNewLine: true, head: childProc.logHead});
        var err = toErrSentence(buf.toString());
        forEachValueIn(provider.consumerMap, endCaptureConsumer, err);
        if (dev.err !== err) {
          updateWholeUI();
        }
      });

      childProc.on('close', function () { //exited or failed to spawn
        if (Object.keys(provider.consumerMap).length) { //if not exit by endCaptureConsumer, then maybe device is disconnected
          updateWholeUI();
        }
        provider.pid = 0; //prevent from killing me again
        forEachValueIn(provider.consumerMap, endCaptureConsumer, provider.didOutput ? '' : childProc.__err ? childProc.__err : 'capture process had internal error, exited without any output');
      });
    } //end of condition [createCaptureProvider.called]

    if (provider === dev.liveStreamer) {
      updateLiveCaptureStatusUI();
    }
  }); //end of prepareDeviceFile
}

function endCaptureConsumer(res/*Any Type Output Stream*/, reason) {
  var provider, consumerMap;
  if (!res || !(provider = res.captureProvider) || !(consumerMap = provider.consumerMap) || !consumerMap[res.consumerId]) {
    return; //if not exist in consumerMap, do nothing. This can prevent endless loop of error event of the output stream
  }
  log(res.logHead + 'cleanup capture consumer ' + res.consumerId + (reason ? (' due to ' + reason) : ''));

  delete consumerMap[res.consumerId];

  if (reason !== 'canceled') { //end(res, reason) only if not already closed
    end(res, reason);
  }

  if (res.on_captureBeginOrFailed) {
    res.on_captureBeginOrFailed(toErrSentence(reason));
    res.on_captureBeginOrFailed = null;
  }

  if (res.filename && !res.__bytesWritten) {
    setTimeout(function () {
      res.filename.split(' ').forEach(function (filename) {
        log('delete "' + outputDirSlash + filename + '" due to empty file');
        try {
          fs.unlinkSync(outputDirSlash + filename);
        } catch (err) {
          logIf(err.code !== 'ENOENT', 'failed to delete "' + outputDirSlash + filename + '". ' + stringifyError(err));
        }
      });
    }, 0);
  }

  if (Object.keys(consumerMap).length === 0) {
    if (reason === 'another incompatible live capture is going to run' && provider.pid) {
      exitCaptureProcess();
    } else {
      log(provider.logHead + 'delay kill capture process');
      setTimeout(function () {
        if (Object.keys(consumerMap).length === 0) {
          exitCaptureProcess();
        } else {
          log(provider.logHead + 'capture process revival due to consumer came in');
        }
      }, 1500);
    }
  }

  function exitCaptureProcess() {
    if (provider === provider.dev.liveStreamer) {
      log(provider.logHead + 'detach this live streamer');
      provider.dev.liveStreamer = null;
    }
    if (provider.aimgDecoder) {
      delete aimgDecoderMap[provider.aimgDecoder.aimgDecoderId];
    }
    if (provider.pid) {
      log(provider.logHead + 'kill this live streamer process pid_' + provider.pid + ' due to no more consumer');
      try {
        process.kill(provider.pid, 'SIGKILL');
      } catch (err) {
        logIf(err.code !== 'ENOENT', 'failed to kill process pid_' + provider.pid + '. ' + stringifyError(err));
      }
    }
  }

  updateLiveCaptureStatusUI();
}

function startRecording(q/*same as capture*/, on_complete) {
  prepareDeviceFile(q.device, function/*on_complete*/(err) {
        if (err) {
          return on_complete(err);
        }
        var filename = makeFilenameByCaptureParameter(q, true/*for record*/);
        if (checkFfmpeg.success) {
          var logHead = '[Converter(live ' + q.type + ' -> ' + filename + '.mp4&webm' + ')]';
          var args = [];
          //------------------------now make global parameters------------------------
          args.push('-y'); //-y: always overwrite output file
          if (conf.ffmpegStatistics !== true) {
            args.push('-nostats');
          }
          if (conf.ffmpegDebugLog === true) {
            args.push('-loglevel', 'debug');
          }
          //------------------------now make input parameters------------------------
          if (q.type === 'ajpg') {
            args.push('-f', 'image2pipe', '-vcodec', 'mjpeg');
          } else if (q.type === 'apng') {
            args.push('-f', 'image2pipe', '-vcodec', 'png');
          }
          args.push('-r', q.fps); //rate
          args.push('-i', '-'); //from stdin
          //------------------------now make output parameters------------------------
          args.push('-pix_fmt', 'yuv420p'); //for safari mp4
          args.push(outputDirSlash + filename + '.mp4');
          args.push(outputDirSlash + filename + '.webm');

          var childProc = spawn(logHead, conf.ffmpeg, args, function/*on_close*/(ret) {
            log(logHead + (ret === 0 ? 'complete' : 'failed due to ' + (childProc.__err || 'internal error')));
            callbackOnce(ret === 0 ? '' : childProc.__err || 'internal error');
          }, {stdio: ['pipe'/*stdin*/, 'pipe'/*stdout*/, 'pipe'/*stderr*/]});

          childProc.stdin.filename = filename + '.mp4' + ' ' + filename + '.webm'; //needed by capture(), deviceControl
          childProc.stdin.logHead = '[FileWriter(RecorderConverter)' + filename + '.mp4&webm' + ')]';

          capture(childProc.stdin, q, function/*on_captureBeginOrFailed*/(err) { //---------do capture, save output to childProc.stdin----------
            callbackOnce(err, childProc.stdin);
          });

          childProc.stdin.on('error', function (err) {
            log(childProc.stdin.logHead + stringifyError(err));
          });
        }
        else { //------------------------if local ffmpeg is not available, then record as animated image----------------
          var wfile = fs.createWriteStream(outputDirSlash + filename);
          wfile.filename = filename;  //needed by capture(), deviceControl
          wfile.logHead = '[FileWriter(Record) ' + filename + ']';

          wfile.on('open', function () {
            log(wfile.logHead + 'opened for write');

            capture(wfile, q, function/*on_captureBeginOrFailed*/(err) { //---------do capture, save output to wfile----------
              callbackOnce(err, wfile);
            });
          });
          wfile.on('close', function () { //file's 'close' event will always be fired. If have pending output, it will be fired after 'finish' event which means flushed.
            log(wfile.logHead + 'closed');
            callbackOnce('recording is stopped'); //do not worry, normally 'open' event handler have cleared this callback
          });
          wfile.on('error', function (err) {
            log(wfile.logHead + stringifyError(err));
            callbackOnce('file operation error ' + err.code);
          });
        }
        return ''; //just to avoid compiler warning
      }
  );

  function callbackOnce(err, wfile) {
    if (on_complete) {
      on_complete(err, wfile);
      on_complete = null;
    }
  }
}

/**
 * Play or download recorded video file
 * must have been checked by !chkerrPlayRecordedFileParameter(q)
 * @param httpOutputStream
 * @param q option
 *  {
 *    device:  device serial number
      filename: FilenameInfo object
      fps:     [optional] rate for apng, ajpg only. Must be in range MIN_FPS_PLAY_AIMG~MAX_FPS_PLAY_AIMG
    }
 * @param forDownload  true/false
 * @param range [optional] {start:?, end:? not included}
 */
function playOrDownloadRecordedFile(httpOutputStream, q, forDownload, range) {
  var res = httpOutputStream;
  var filename = q.filename.filename;
  var realType = q.filename.type;
  var forPlayAnimatedImage = !forDownload && aimgTypeSet[realType];
  q.fps = q.fps || q.filename.origFps;

  var stats;
  try {
    stats = fs.statSync(outputDirSlash + filename);
  } catch (err) {
    return end(res, err.code === 'ENOENT' ? 'error: file not found' : 'file operation error ' + err.code);
  }
  if (!stats.size) {
    return end(res, 'error: file is empty');
  }

  res.setHeader('Content-Type', (forDownload ? allTypeMimeMapForDownload : allTypeMimeMapForPlay)[realType]);

  if (forPlayAnimatedImage) {
    range = undefined; //----animated image is played by private method, do not support range request
  } else {
    if (forDownload) {
      res.setHeader('Content-Disposition', 'attachment;filename=' + filename);
    }
    if (range && stats.size) { //------------------ support partial data request ---------------------
      res.setHeader('Accept-Ranges', 'bytes');
      range.start = Math.min(Math.max(Number(range.start), 0), stats.size - 1) || 0;
      range.end = Math.min(Math.max(Number(range.end), range.start), stats.size - 1) || (stats.size - 1);
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + stats.size);
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.setHeader('Content-Length', stats.size);
      range = undefined;
    }
  }
  /*
   * ------------------ now open file ---------------------
   */
  var rfile = fs.createReadStream(outputDirSlash + filename, range);
  rfile.logHead = '[FileReader(' + (forDownload ? 'Download' : 'Play') + ' ' + filename + ']';
  res.logHead = res.logHead.slice(0, -1) + ' @ ' + rfile.logHead.slice(1, -1) + ']';
  if (forPlayAnimatedImage) {
    rfile.aimgDecoder = aimgCreateContext(filename, q.playerId || '');
  }

  rfile.on('open', function () {
    log(rfile.logHead + 'opened for read');

    rfile.on('data', function (buf) {
      if (forPlayAnimatedImage) { //play apng, ajpg specially, translate it to multipart output
        rfile.aimgDecoder.isLastBuffer = (stats.size -= buf.length) === 0;
        aimgDecode(rfile.aimgDecoder, [res], buf, 0, buf.length, fnDecodeRest);
      } else { //for normal video or download any type, just write content
        if (range && !res.headersSent) {
          res.writeHead(206); //Partial Content
        }
        write(res, buf);
      }

      function fnDecodeRest(pos/*rest data start position*/) {
        rfile.pause();
        rfile.timer = setTimeout(function () {
          rfile.resume();
          rfile.timer = null;
          aimgDecode(rfile.aimgDecoder, [res], buf, pos, buf.length, fnDecodeRest);
        }, Math.max(1, (rfile.aimgDecoder.startTimeMs + rfile.aimgDecoder.frameIndex * 1000 / q.fps) - Date.now()));
      }
    }); //end of 'data' event handler
  }); //end of 'open' event handler

  rfile.on('close', function () { //file's 'close' event will always be fired
    log(rfile.logHead + 'closed');
    if (!rfile.timer) {
      end(res);
    }
  });
  rfile.on('error', function (err) {
    log(rfile.logHead + stringifyError(err));
    end(res, err.code === 'ENOENT' ? 'error: file not found' : 'file operation error ' + err.code);
    clearTimeout(rfile.timer);
  });

  res.on('close', function () { //closed without normal end(res,...). Note: this event DOES NOT means output data have been flushed
    rfile.close(); //stop reading more
    clearTimeout(rfile.timer);
    if (rfile.aimgDecoder) {
      delete aimgDecoderMap[rfile.aimgDecoder.aimgDecoderId];
    }
  });
  return ''; //just to avoid compiler warning
}

function FilenameInfo(filename) {
  filename = String(filename);
  var match;
  match = filename.match(re_filename);
  if (!match) {
    return;
  }
  var i = 0;
  this.origFilename = match[++i];
  this.device = querystring.unescape(match[++i]);
  this.origFps = Number(match[++i]);
  this.origTimestamp = match[++i];
  this.origType = match[++i];
  this.convertedType = match[++i];
  this.frameIndex = match[++i];
  this.imageType = match[++i];
  this.isImage = this.imageType;
  this.isVideo = !this.imageType;
  this.type = this.imageType || this.convertedType || this.origType;
  //OK
  this.filename = filename;
  this.isValid = true;
}

FilenameInfo.prototype.toString = function () {
  return this.filename;
};

FilenameInfo.parse = function (filename, deviceOrAry, filter) {
  setchkerr('');
  var fname = new FilenameInfo(filename);
  if (!fname.isValid && setchkerr('`filename`: invalid format')) {
    return null;
  }
  var isDevAry = deviceOrAry && Array.isArray(deviceOrAry);
  return (isDevAry && deviceOrAry.indexOf(fname.device) < 0 && setchkerr('`filename`: is other device\'s file') ||
      !isDevAry && deviceOrAry && fname.device !== deviceOrAry && setchkerr('`filename` is other device\'s file') ||
      filter.origType && fname.origType !== filter.origType && setchkerr('`filename`: original type must be ' + filter.origType) ||
      filter.image === true && !fname.isImage && setchkerr('`filename`: type must be any type of image') ||
      filter.video === true && !fname.isVideo && setchkerr('`filename`: type must be any type of video') ||
      filter.aimgVideo === true && !aimgTypeSet[fname.type] && setchkerr('`filename`: type must be ajpg or apng') ||
      filter.type && fname.type !== filter.type && setchkerr('`filename`: type must be ' + filter.type)
      ) ? null : fname;
};

function sortVideoFilenameInfoAryByOrigTimestamp(filenameAry, ascOrDesc) {
  return filenameAry.sort(function (a, b) {
    if (a.origTimestamp === b.origTimestamp) {
      a = allVideoTypeOrderMap[a.type];
      b = allVideoTypeOrderMap[b.type];
    } else {
      a = a.origTimestamp;
      b = b.origTimestamp;
    }
    if (ascOrDesc) {
      return (a > b) ? +1 : (a < b) ? -1 : 0;
    } else {
      return (a > b) ? -1 : (a < b) ? +1 : 0;
    }
  });
}

function sortImageFilenameInfoAry(filenameAry, ascOrDesc) {
  return filenameAry.sort(function (a, b) {
    if (a.origTimestamp === b.origTimestamp) {
      a = a.frameIndex;
      b = b.frameIndex;
    } else {
      a = a.origTimestamp;
      b = b.origTimestamp;
    }
    if (ascOrDesc) {
      return (a > b) ? +1 : (a < b) ? -1 : 0;
    } else {
      return (a > b) ? -1 : (a < b) ? 1 : 0;
    }
  });
}

function getFilenameInfoByOrigTimestampIndex(filenameAry, fileindex) {
  var lastValue = null, i = -1;
  return filenameAry.some(function (curValue) {
    if (!lastValue || curValue.origTimestamp !== lastValue.origTimestamp) {
      i++;
      lastValue = curValue;
      return (fileindex === i);
    }
    return false;
  }) ? lastValue : null;
}

function getFileindexOfOrigTimestamp(filenameAry, origTimestamp) {
  var lastValue = null, i = -1;
  return filenameAry.some(function (curValue) {
    if (!lastValue || curValue.origTimestamp !== lastValue.origTimestamp) {
      i++;
      lastValue = curValue;
      return (curValue.origTimestamp === origTimestamp);
    }
    return false;
  }) ? i : -1;
}

function getCountOfOrigTimestamp(filenameAry) {
  var lastValue = null, i = -1;
  filenameAry.forEach(function (curValue) {
    if (!lastValue || curValue.origTimestamp !== lastValue.origTimestamp) {
      i++;
      lastValue = curValue;
    }
  });
  return i + 1;
}

function getRecordingFiles() {
  var filenameAry = [];
  forEachValueIn(devMgr, function (dev) {
    if (dev.liveStreamer) {
      forEachValueIn(dev.liveStreamer.consumerMap, function (res) {
        if (res.filename) {
          filenameAry = filenameAry.concat(res.filename.split(' '));
        }
      });
    }
  });
  return filenameAry;
}

function findFiles(deviceOrAry, filter, on_complete) {
  fs.readdir(conf.outputDir, function (err, filenameAry) {
    if (err) {
      log('failed to readdir "' + conf.outputDir + '". ' + stringifyError(err));
      return on_complete(err.code === 'ENOENT' ? 'error: dir not found' : 'dir operation error ' + err.code, []);
    }
    var recordingFilenameAry;
    var filenameInfoAry = [];
    filenameAry.forEach(function (filename) {
      if ((filename = FilenameInfo.parse(filename, deviceOrAry, filter))) {
        getOrCreateDevCtx(filename.device); //ensure having created device context
        recordingFilenameAry = recordingFilenameAry || getRecordingFiles();
        if (recordingFilenameAry.indexOf(filename.filename) < 0) {
          filenameInfoAry.push(filename);
        }
      }
    });
    return on_complete('', filenameInfoAry);
  });
}

function deleteFiles(deviceOrAry, filter) {
  findFiles(deviceOrAry, filter, function/*on_complete*/(err, filenameAry) {
    if (err) {
      return;
    }
    filenameAry.forEach(function (filename) {
      log('delete "' + outputDirSlash + filename + '"');
      try {
        fs.unlinkSync(outputDirSlash + filename);
      } catch (err) {
        logIf(err.code !== 'ENOENT', 'failed to delete "' + outputDirSlash + filename + '". ' + stringifyError(err));
      }
    });
    loadResourceSync();
  });
}

function updateLiveCaptureStatusUI() {
  var oldVer = status.ver;
  setTimeout(function () {
    if (oldVer === status.ver && Object.keys(status.consumerMap).length) {
      var sd = {}, json;

      forEachValueIn(devMgr, function (dev, device) {
        var qdevice = htmlIdEncode(device);
        var liveCaptureRecorderCount = 0;
        Object.keys(aimgTypeSet).forEach(function (type) {
          var liveViewerCount = 0, recordingCount = 0;
          if (dev.liveStreamer && dev.liveStreamer.type === type) {
            forEachValueIn(dev.liveStreamer.consumerMap, function (res) {
              if (res.filename) {
                recordingCount += 1;
              } else {
                liveViewerCount += 1;
              }
            });
          }
          liveCaptureRecorderCount += recordingCount + liveViewerCount;
          sd['liveViewCount_' + type + '_' + qdevice] = liveViewerCount ? '(' + liveViewerCount + ')' : '';
          sd['recordingIndicator_' + type + '_' + qdevice] = recordingCount ? '(1)' : '';
        });
        sd['liveCaptureRecorderCount_' + qdevice] = liveCaptureRecorderCount;
      });

      if ((json = JSON.stringify(sd)) !== status.lastDataJson) {
        status.lastDataJson = json;
        status.ver = getTimestamp();
      }
      json = '{"appVer":"' + status.appVer + '", "ver":"' + status.ver + '","data":' + json + '}';

      forEachValueIn(status.consumerMap, function (res) {
        if (res.previousVer !== status.ver || res.previousAppVer !== status.appVer) {
          end(res, json);
          delete status.consumerMap[res.consumerId];
        }
      });
    }
  }, 0);
}

function updateWholeUI() {
  var oldVer = status.appVer;
  setTimeout(function () {
    if (oldVer === status.appVer) {
      status.appVer = getTimestamp();
      var json = '{"appVer":"' + status.appVer + '"}';
      forEachValueIn(status.consumerMap, function (res) {
        end(res, json); //cause browser to refresh page
      });
      status.consumerMap = {};
    }
  }, 0);
}

var PNG_HEAD_HEX_STR = '89504e470d0a1a0a', APNG_STATE_READ_HEAD = 0, APNG_STATE_READ_DATA = 1, APNG_STATE_FIND_TAIL = 2;

function aimgCreateContext(origFilename, playerId) {
  var context = {};
  var fname = new FilenameInfo(origFilename);
  //public area
  context.filename = fname.origFilename;
  context.aimgDecoderId = origFilename + '~' + (playerId || '');
  aimgDecoderMap[context.aimgDecoderId] = context;
  context.frameIndex = 0;

  //private area
  context.imageType = fname.origType.slice(1); //axxx -> xxx
  context.is_apng = fname.origType === 'apng';
  context.httpHead = '--' + MULTIPART_BOUNDARY + '\r\n' + 'Content-Type: ' + allTypeMimeMapForPlay[context.imageType] + '\r\n\r\n'; //safari need \r\n instead of \n
  context.httpHeadPrependWithCRLF = '\r\n' + context.httpHead;

  context.bufAry = [];

  if (context.is_apng) {
    context.tmpBuf = new Buffer(12); //min chunk
    context.state = APNG_STATE_READ_HEAD;
    context.requiredSize = 8; //head size
    context.scanedSize = 0;
  } else { // ajpg
    context.isMark = false;
  }

  return context;
}

/*
 * write animated png, jpg stream to all consumers
 */
function aimgDecode(context, consumerMap, buf, pos, endPos, fnDecodeRest /*optional*/) {
  if (context.stopped) {
    return;
  }
  var nextPos = pos, unsavedStart = pos;
  if (context.is_apng) {//---------------------------------------------png----------------------------------------------
    for (; pos < endPos; pos = nextPos) {
      nextPos = Math.min(pos + context.requiredSize, endPos);
      if (context.state === APNG_STATE_FIND_TAIL || context.state === APNG_STATE_READ_HEAD) {
        buf.copy(context.tmpBuf, context.scanedSize, pos, nextPos);
      }
      context.scanedSize += (nextPos - pos);
      context.requiredSize -= (nextPos - pos);
      if (context.requiredSize) {
        break;
      }

      switch (context.state) {
        case APNG_STATE_FIND_TAIL:
          var chunkDataSize = context.tmpBuf.readUInt32BE(0);
          logIf(conf.logImageDecoderDetail, context.filename + '~frame' + context.frameIndex + ' chunkHead ' + context.tmpBuf.slice(4, 8) + ' ' + chunkDataSize);
          if (chunkDataSize === 0 && context.tmpBuf.readInt32BE(4) === 0x49454E44) { //ok, found png tail
            if (!writeWholeImage()) {
              return;
            }
          } else {                                                          //not found tail
            if (chunkDataSize === 0) {
              log(context.filename + '~frame' + context.frameIndex + ' ********************** chunkSize 0 *************************');
              context.state = APNG_STATE_FIND_TAIL;
              context.requiredSize = 12; //min chunk size
              context.scanedSize = 0;
            } else {
              context.state = APNG_STATE_READ_DATA;
              context.requiredSize = chunkDataSize;
              context.scanedSize = 0;
            }
          }
          break;
        case APNG_STATE_READ_HEAD:
          var headHexStr = context.tmpBuf.slice(0, 8).toString('hex');
          logIf(conf.logImageDecoderDetail, context.filename + '~frame' + context.frameIndex + ' head ' + headHexStr);
          if (headHexStr !== PNG_HEAD_HEX_STR) {
            log(context.filename + '~frame' + context.frameIndex + ' ************************* wrong head*************************');
            forEachValueIn(consumerMap, function (res) {
              end(res, 'internal error: wrong png head');
            });
            context.bufAry = [];
            context.stopped = true;
            return;
          }
          context.state = APNG_STATE_FIND_TAIL;
          context.requiredSize = 12; //min chunk size
          context.scanedSize = 0;
          break;
        case APNG_STATE_READ_DATA:
          logIf(conf.logImageDecoderDetail, context.filename + '~frame' + context.frameIndex + ' chunkData ' + context.scanedSize);
          context.state = APNG_STATE_FIND_TAIL;
          context.requiredSize = 12; //min chunk size
          context.scanedSize = 0;
          break;
      }//end of switch
    } //end of for (;;)
  } else { //---------------------------------------------------jpg-----------------------------------------------------
    for (; pos < endPos; pos = nextPos) {
      nextPos = pos + 1;
      if (context.isMark && buf[pos] === 0xD9) {
        if (!writeWholeImage()) {
          return;
        }
      } else {
        context.isMark = buf[pos] === 0xff;
      }
    } //end of for (;;)  }
  }

  //----------------------------------now, no more data in the buffer---------------------------------------------------

  if (unsavedStart < endPos) {
    if (context.isLastBuffer) { //found incomplete image
      log(context.filename + '~frame' + context.frameIndex + ' Warning: incomplete');
      writeWholeImage();
    } else {
      context.bufAry.push(buf.slice(unsavedStart, endPos));
    }
  }

  function writeWholeImage() {
    context.bufAry.push(buf.slice(unsavedStart, nextPos));
    unsavedStart = nextPos;
    var isLastFrame = context.isLastBuffer && (nextPos === endPos);
    var wholeImageBuf = Buffer.concat(context.bufAry);
    context.bufAry = [];
    if (!context.startTimeMs) {
      context.startTimeMs = Date.now(); //for ajpg/apng playback
    }

    forEachValueIn(consumerMap, function (res) {
      if (res.setHeader) { //------------------for http response ----------------
        if (!res.__bytesWritten) {
          write(res, context.httpHead);
        }
        write(res, wholeImageBuf);
        if (isLastFrame) {
          end(res); //------------------------end output stream when no more frame-------------------------
        } else {
          write(res, context.httpHeadPrependWithCRLF); //write next content-type early to force Chrome draw image immediately.
        }
      } else { //----------------------------for file output stream and other...----------------
        write(res, wholeImageBuf);
        if (isLastFrame) {
          end(res); //------------------------end output stream when no more frame-------------------------
        }
      }
    });

    //save image in memory for later used by /saveImage /setAutoDumpLatestImages command
    context.lastImage = {
      filename: context.filename + '~frame' + context.frameIndex + '.' + context.imageType, //should respect re_filename;
      data: wholeImageBuf
    };

    //keep latest frames to be dumped
    if ((conf.latestFramesToDump)) {
      var filename = context.filename + '-frame' + context.frameIndex + '.' + context.imageType; //should respect re_filename
      logIf(conf.logImageDumpFile, 'write "' + outputDirSlash + filename + '"');
      try {
        fs.writeFileSync(outputDirSlash + filename, wholeImageBuf)
      } catch (err) {
        log('failed to write "' + outputDirSlash + filename + '". ' + stringifyError(err));
      }
      if (context.frameIndex >= conf.latestFramesToDump) {
        filename = context.filename + '-frame' + (context.frameIndex - conf.latestFramesToDump) + '.' + context.imageType; //should respect re_filename
        logIf(conf.logImageDumpFile, 'delete"' + outputDirSlash + filename + '"');
        try {
          fs.unlinkSync(outputDirSlash + filename);
        } catch (err) {
          logIf(err.code != 'ENOENT', 'failed to delete "' + outputDirSlash + filename + '". ' + stringifyError(err));
        }
      }
    }

    if (isLastFrame) {
      setTimeout(function () { //delay release image cache for "Save Image" functionality
        delete aimgDecoderMap[context.aimgDecoderId];
      }, 5 * 1000);
    }

    wholeImageBuf = null;
    context.frameIndex++;
    if (context.is_apng) {
      context.state = APNG_STATE_READ_HEAD;
      context.requiredSize = 8; //head size
      context.scanedSize = 0;
    } else {
      context.isMark = false;
    }

    if (fnDecodeRest && !isLastFrame) {
      fnDecodeRest(nextPos);
      return false;
    }
    return true;
  }
} //end of aimgDecode()

/*
 * convert CRLF or CRCRLF to LF, return array of converted buf. Currently, this function only have effect on Windows OS
 */
function convertCRLFToLF(context, requiredCrCount, buf) {
  if (!requiredCrCount) { //lucky! no CR prepended, so need not convert.
    return [buf];
  }
  var bufAry = [], startPos = 0, crCount = 0;
  /*
   * Resolve orphan [CR,CR] or [CR] which are produced by previous call of this function.
   * If it is followed by [LF] or [CR,LF], then they together are treated as a [LF],
   * Otherwise, the orphan seq will be output normally.
   */
  if (context.orphanCrCount) {
    var restCrCount = requiredCrCount - context.orphanCrCount;
    // if adbNewLineSeq is found then skip rest CR, start from LF. Otherwise push orphan CR into result
    if (!restCrCount && buf[0] === LF || restCrCount && buf[0] === CR && buf.length > 1 && buf[1] === LF) {
      startPos = restCrCount;
    } else {
      bufAry.push(context.orphanCrCount === 2 ? BUF_CR2 : BUF_CR);
    }
    context.orphanCrCount = 0;
  }

  /*
   * convert CRLF or CRCRLF to LF
   */
  for (var i = startPos; i < buf.length; i++) {
    if (buf[i] === CR) {
      crCount++;

      /*
       *if no more data to match adbNewLineSeq, then save it as orphan CR which will
       *be processed by next call of this function
       */
      if (i + 1 === buf.length) {
        context.orphanCrCount = Math.min(crCount, requiredCrCount);
        //commit data in range from last start position to current position-orphanCrCount
        if (startPos < buf.length - context.orphanCrCount) {
          bufAry.push(buf.slice(startPos, buf.length - context.orphanCrCount));
        }
        return bufAry;
      }
    }
    else {
      /*
       * if found 2 or 2 CR followed by LF, then CR will be discarded.
       * and data before CR will be pushed to result.
       */
      if (crCount >= requiredCrCount && buf[i] === LF) {
        //commit data in range from last start position to current position-requiredCrCount
        bufAry.push(buf.slice(startPos, i - requiredCrCount));
        startPos = i;
      }

      crCount = 0;
    }
  }

  bufAry.push(buf.slice(startPos));
  return bufAry;
}//end of convertCRLFToLF()

function setDefaultHttpHeader(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private, proxy-revalidate, s-maxage=0'); // HTTP 1.1.
  res.setHeader('Pragma', 'no-cache'); // HTTP 1.0.
  res.setHeader('Expires', 0); // Proxies.
  res.setHeader('Vary', '*'); // Proxies.
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function logHttpRequest(req, logHead) {
  log(logHead + 'URL= ' + req.url +
      (req.headers.range ? '\n' + logHead + 'HEADERS["RANGE"]= ' + req.headers.range + '' : '') +
      (conf.logHttpReqDetail ? '\n' + logHead + 'SOURCE= ' + req.connection.remoteAddress + ':' + req.connection.remotePort + '' : '') +
      (conf.logHttpReqDetail ? '\n' + logHead + 'HEADERS["USER-AGENT"]= ' + req.headers['user-agent'] + '' : ''));
}

function startStreamWeb() {
  var httpServer, httpSeq = 0, _isAnyIp = isAnyIp(conf.ip), smark = (conf.ssl.on ? 's' : '');
  conf.ipForHtmlLink = (isAnyIp(conf.ip) ? getFirstIp() : conf.ip);
  if (conf.ssl.on) {
    log('load SSL server certificate and private key from PKCS12 file: ' + conf.ssl.certificateFilePath);
    var options;
    try {
      options = {pfx: fs.readFileSync(conf.ssl.certificateFilePath)};
    } catch (err) {
      log('failed to read certificate file "' + conf.ssl.certificateFilePath + '". ' + stringifyError(err), {stderr: true});
      process.exit(1);
      return;
    }
    process.streamWeb = httpServer = require('https').createServer(options, handler);
  } else {
    process.streamWeb = httpServer = require('http').createServer(handler);
  }
  httpServer.logHead = '[StreamWebSrv]';
  httpServer.on('error', function (err) {
    log(httpServer.logHead + stringifyError(err), {stderr: true});
    process.exit(1);
  });
  log(httpServer.logHead + 'listen on ' + ( _isAnyIp ? '*' : conf.ip) + ':' + conf.port);
  httpServer.listen(conf.port, _isAnyIp ? undefined : conf.ip, function/*on_complete*/() {
    log(httpServer.logHead + 'OK');
  });

  function handler(req, res) {
    // set stream error handler to prevent from crashing
    res.on('error', function (err) {
      log((res.logHead || '[HTTP' + smark.toUpperCase() + ' ' + res.req.url) + stringifyError(err));
    });
    if (req.url.length > 1024 || req.method !== 'GET' || req.url === '/favicon.ico') {
      return res.end();
    }
    var parsedUrl = url.parse(req.url, true/*querystring*/), q = parsedUrl.query;
    switch (parsedUrl.pathname) {
      case '/common.css':
      case '/rotatescale.css':
      case '/common.js':
      case '/jquery-2.0.3.js':
        res.setHeader('Content-Type', parsedUrl.pathname.match(re_extName)[0] === '.css' ? 'text/css' : 'text/javascript');
        return res.end(htmlCache[parsedUrl.pathname.slice(1)]);
        break;
    }
    if (chkerrRequired('device', q.device)) {
      return res.end(chkerr);
    }
    q.qdevice = querystring.escape(q.device);
    var dev = devMgr[q.device];
    var _accessKey = dev ? dev.accessKey : '';
    if (_accessKey && _accessKey !== q.accessKey || !_accessKey && conf.adminWeb.adminKey) {
      res.logHead = res.logHeadSimple = '[http' + smark.toLowerCase() + '_' + (res.seq = ++httpSeq) + ']';
      logHttpRequest(req, res.logHeadSimple);
      res.statusCode = 403; //access denied
      return end(res, 'access denied');
    }

    res.logHead = res.logHeadSimple = '[http' + smark.toLowerCase() + '_' + (res.seq = ++httpSeq) + ']';
    logHttpRequest(req, res.logHeadSimple);
    res.on('close', function () { //closed without normal end(res,...)
      log(res.logHeadSimple + 'CLOSED by peer');
      res.__isClosed = true;
    });
    res.on('finish', function () { //response stream have been flushed and ended without log
      logIf(!res.__isEnded, res.logHeadSimple + 'END');
    });

    setDefaultHttpHeader(res);

    if (!q.adminKey && req.headers.cookie && (q.adminKey = req.headers.cookie.match(/adminKey=([^;]+)/))) {
      q.adminKey = querystring.unescape(q.adminKey[1]);
    }

    switch (parsedUrl.pathname) {
      case '/capture': //---------------------------send capture result to browser & optionally save to file------------
        if (chkerrCaptureParameter(q)) {
          return end(res, chkerr);
        }
        capture(res, q, null/*on_captureBeginOrFailed=null*/);
        break;
      case '/playRecordedFile': //---------------------------replay recorded file---------------------------------------
      case '/downloadRecordedFile': //---------------------download recorded file---------------------------------------
        if (conf.protectOutputDir && !(conf.adminWeb.adminKey && q.adminKey === conf.adminWeb.adminKey)) {
          res.statusCode = 403; //access denied
          return end(res, 'access denied');
        }
        var forDownload = (parsedUrl.pathname === '/downloadRecordedFile');
        if (chkerrRequired('filename', q.filename) || !(q.filename = FilenameInfo.parse(q.filename, q.device, {video: true})) ||
            chkerrOptional('as(optional)', q.as, html5videoTypeAry) ||
            !forDownload && aimgTypeSet[q.filename.type] && chkerrOptional('fps(optional)', (q.fps = Number(q.fps)), MIN_FPS_PLAY_AIMG, MAX_FPS_PLAY_AIMG)) {
          return end(res, chkerr);
        }
        var range = undefined;
        if (req.headers.range) {
          var match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/i);
          if (match) {
            range = {start: match[1] ? Number(match[1]) : 0, end: match[2] ? Number(match[2]) : undefined};
          }
        }
        playOrDownloadRecordedFile(res, q, forDownload, range);
        break;
      case '/liveViewer':  //------------------------------show live capture (Just as a sample) ------------------------
        if (chkerrCaptureParameter(q)) {
          return end(res, chkerr);
        }
        prepareDeviceFile(q.device, function/*on_complete*/(err) {
              if (err) {
                return end(res, err);
              }
              res.setHeader('Content-Type', 'text/html');
              return end(res, htmlCache['aimg_liveViewer.html'] //this html will in turn open URL /playRecordedFile?....
                  .replace(/@device\b/g, q.qdevice)
                  .replace(/#device\b/g, htmlEncode(q.device))
                  .replace(/\$device\b/g, htmlIdEncode(q.device))
                  .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
                  .replace(/#accessKey\b/g, htmlEncode(q.accessKey || ''))
                  .replace(/@type\b/g, q.type)
                  .replace(/@imageType\b/g, q.type.slice(1)) //ajpg->jpg
                  .replace(/#typeDisp\b/g, htmlEncode(allTypeDispNameMap[q.type]))
                  .replace(/@MIN_FPS\b/g, MIN_FPS)
                  .replace(/@MAX_FPS\b/g, MAX_FPS)
                  .replace(/@fps\b/g, q.fps)
                  .replace(/@scale\b/g, q.scale_origVal)
                  .replace(/@rotate\b/g, q.rotate)
                  .replace(new RegExp('<option value="' + q.rotate + '"', 'g'), '$& selected')  //set selected rotate angle
              );
            }
        );
        break;
      case '/fileViewer':  //---------------------------show recorded file  (Just as a sample)--------------------------
        if (conf.protectOutputDir && !(conf.adminWeb.adminKey && q.adminKey === conf.adminWeb.adminKey)) {
          res.statusCode = 403; //access denied
          return end(res, 'access denied');
        }
        if (q.filename) {
          if (!(q.filename = FilenameInfo.parse(q.filename, q.device, {video: true}))) {
            return end(res, chkerr);
          }
        } else {
          if (chkerrRequired('fileindex', (q.fileindex = Number(q.fileindex || 0)), 0, 0xffffffff)) {
            return end(res, chkerr);
          }
        }
        findFiles(q.device, {video: true}, function/*on_complete*/(err, filenameAry) {
          if (err) {
            return end(res, err);
          }
          filenameAry = sortVideoFilenameInfoAryByOrigTimestamp(filenameAry, false/*desc*/);
          if (q.filename) {
            q.fileindex = getFileindexOfOrigTimestamp(filenameAry, q.filename.origTimestamp);
          } else {
            q.filename = getFilenameInfoByOrigTimestampIndex(filenameAry, q.fileindex);
          }
          if (q.fileindex < 0 || !q.filename) {
            return end(res, 'error: file not found');
          }
          if (aimgTypeSet[q.filename.type] && chkerrOptional('fps(optional)', (q.fps = Number(q.fps)), MIN_FPS_PLAY_AIMG, MAX_FPS_PLAY_AIMG)) {
            return end(res, chkerr);
          }
          var fileGroupCount;
          fileGroupCount = getCountOfOrigTimestamp(filenameAry);
          res.setHeader('Content-Type', 'text/html');
          return end(res, htmlCache[aimgTypeSet[q.filename.type] ? 'aimg_fileViewer.html' : 'video_fileViewer.html'] //this html will in turn open URL /playRecordedFile?....
              .replace(/@device\b/g, q.qdevice)
              .replace(/#device\b/g, htmlEncode(q.device))
              .replace(/\$device\b/g, htmlIdEncode(q.device))
              .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
              .replace(/#accessKey\b/g, htmlEncode(q.accessKey || ''))
              .replace(/#type\b/g, q.filename.type)
              .replace(/#typeDisp\b/g, htmlEncode(allTypeDispNameMap[q.filename.type]))
              .replace(/@imageType\b/g, q.filename.type.slice(1)) //ajpg->jpg
              .replace(/@fileCount\b/g, fileGroupCount)
              .replace(/@fileindex\b/g, q.fileindex)
              .replace(/@origFilename\b/g, querystring.escape(q.filename.origFilename))
              .replace(/@timestamp\b/g, stringifyTimestamp(q.filename.origTimestamp))
              .replace(/@maxFileindex\b/g, fileGroupCount - 1)
              .replace(/@olderFileindex\b/g, Math.min(q.fileindex + 1, fileGroupCount - 1))
              .replace(/@newerFileindex\b/g, Math.max(q.fileindex - 1, 0))
              .replace(/@pathname\b/g, parsedUrl.pathname)
              .replace(/@MIN_FPS\b/g, MIN_FPS_PLAY_AIMG)
              .replace(/@MAX_FPS\b/g, MAX_FPS_PLAY_AIMG)
              .replace(/&fps=@fps\b/g, q.fps ? '$&' : '') //remove unnecessary fps querystring
              .replace(/@fps\b/g, q.fps || q.filename.origFps)
              .replace(/@playerId\b/g, getTimestamp())
              .replace(/#playerId\b/g, getTimestamp.lastValue)
              .replace(/\bshowIfExists_mp4\b/g, fs.existsSync(outputDirSlash + q.filename.origFilename + '.mp4') ? '' : 'style="display:none"')
              .replace(/\bshowIfExists_webm\b/g, fs.existsSync(outputDirSlash + q.filename.origFilename + '.webm') ? '' : 'style="display:none"')
              .replace(/unprotect&/g, q.adminKey ? 'adminKey=' + querystring.escape(q.adminKey) + '&' : '')
              .replace(/name="adminKey" value="#adminKey"/g, q.adminKey ? 'name="adminKey" value="' + htmlEncode(q.adminKey) + '"' : '')
          );
        });
        break;
      case '/saveImage': //------------------------------Save Current Image --------------------------------------------
        var aimgDecoder;
        if (q.filename) { //--------------------extract image from recorded file being played---------------------------
          if (!(q.filename = FilenameInfo.parse(q.filename, q.device, {aimgVideo: true}))) {
            return end(res, chkerr);
          }
          if (!(aimgDecoder = aimgDecoderMap[q.filename + '~' + (q.playerId || '')])) {
            return end(res, 'error: file not played');
          }
        } else { //---------------------------------extract image from live captured image stream-----------------------
          if (!dev || !dev.liveStreamer || !dev.liveStreamer.aimgDecoder) {
            return end(res, 'error: no capture');
          }
          aimgDecoder = dev.liveStreamer.aimgDecoder;
        }

        if (!aimgDecoder.lastImage) {
          return end(res, 'error: image not found');
        }
        log('write "' + outputDirSlash + aimgDecoder.lastImage.filename + '"');
        try {
          fs.writeFileSync(outputDirSlash + aimgDecoder.lastImage.filename, aimgDecoder.lastImage.data);
        } catch (err) {
          log('failed to write "' + outputDirSlash + aimgDecoder.lastImage.filename + '". ' + stringifyError(err));
          return end(res, 'file operation error ' + err.code);
        }
        end(res, 'OK: ' + aimgDecoder.lastImage.filename);
        break;
      case '/showImage': //--------------------------show saved image --------------------------------------------------
        if (conf.protectOutputDir && !(conf.adminWeb.adminKey && q.adminKey === conf.adminWeb.adminKey)) {
          res.statusCode = 403; //access denied
          return end(res, 'access denied');
        }
        if (chkerrRequired('filename', q.filename) || !(q.filename = FilenameInfo.parse(q.filename, q.device, {image: true}))) {
          return end(res, chkerr);
        }
        res.setHeader('Content-Type', allTypeMimeMapForPlay[q.filename.type]);
        fs.createReadStream(outputDirSlash + q.filename)
            .on('error',function (err) {
              end(res, stringifyError(err));
            }).pipe(res);
        break;
      case '/listSavedImages': //--------------------list all saved images----------------------------------------------
        if (conf.protectOutputDir && !(conf.adminWeb.adminKey && q.adminKey === conf.adminWeb.adminKey)) {
          res.statusCode = 403; //access denied
          return end(res, 'access denied');
        }
        if (chkerrOptional('type(optional)', q.type, Object.keys(imageTypeSet)) ||
            chkerrOptional('order(optional)', q.order, ['asc', 'desc'])) {
          return end(res, chkerr);
        }
        findFiles(q.device, {type: q.type, image: true}, function/*on_complete*/(err, filenameAry) {
          if (err) {
            return end(res, err);
          }
          var isDesc = (q.order === 'desc' || !q.order && q.type);
          filenameAry = sortImageFilenameInfoAry(filenameAry, !isDesc);

          var html = htmlCache['imageList.html']
                  .replace(/@device\b/g, q.qdevice)
                  .replace(/#device\b/g, htmlEncode(q.device))
                  .replace(/\$device\b/g, htmlIdEncode(q.device))
                  .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
                  .replace(/@type\b/g, q.type || '')
                  .replace(/@pathname\b/g, parsedUrl.pathname)
                  .replace(/@order\b/g, q.order || '')
                  .replace(/@realOrder\b/g, isDesc ? 'desc' : 'asc')
                  .replace(/@count\b/g, filenameAry.length)
                  .replace(/unprotect&/g, q.adminKey ? 'adminKey=' + querystring.escape(q.adminKey) + '&' : '')
              ;
          res.setHeader('Content-Type', 'text/html');
          return end(res, html.replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
            htmlBlock = htmlBlock || wholeMatch; //just to avoid compiler warning
            return filenameAry.reduce(function (joinedStr, filename) {
              return joinedStr + htmlBlock.replace(/@filename\b/g, querystring.escape(filename));
            }, ''/*initial joinedStr*/);
          }));
        });
        break;
      case '/touch':
        res.setHeader('Content-Type', 'text/json');
        if (!dev || !dev.liveStreamer || !dev.liveStreamer.didOutput || !Object.keys(dev.liveStreamer.consumerMap).length) {
          return end(res, JSON.stringify('device is not being live viewed'));
        }
        if (chkerrRequired('type', q.type, ['d', 'u', 'o', 'm']) ||
            chkerrRequired('x', q.x = Number(q.x), 0, 1) ||
            chkerrRequired('x', q.y = Number(q.y), 0, 1)) {
          return end(res, JSON.stringify(chkerr));
        }
        if (dev.touchStatus !== 'OK') {
          end(res, JSON.stringify(dev.touchStatus || 'not prepared'));
        } else {
          prepareTouchServer(dev); //ensure adb shell is waiting for command
          sendTouchEvent();
          end(res, JSON.stringify('OK'));
        }
        break;
      case '/sendKey':
        if (!dev || !dev.liveStreamer || !dev.liveStreamer.didOutput || !Object.keys(dev.liveStreamer.consumerMap).length) {
          return end(res, 'error: device is not being live viewed');
        }
        if (chkerrRequired('keyCode', q.keyCode, ['3', '4', '82', '26', '187'])) {
          return end(res, chkerr);
        }
        spawn('[sendKey]', conf.adb, conf.adbOption.concat('-s', q.device, 'shell', '/system/bin/input', 'keyevent', q.keyCode));
        return end(res, 'OK');
        break;
      case '/setOrientation':
        if (!dev || !dev.liveStreamer || !dev.liveStreamer.didOutput || !Object.keys(dev.liveStreamer.consumerMap).length) {
          return end(res, 'error: device is not being live viewed');
        }
        if (chkerrRequired('orientation', q.orientation, ['landscape', 'portrait', 'free'])) {
          return end(res, chkerr);
        }
        spawn('[setOrientation]', conf.adb, conf.adbOption.concat('-s', q.device, 'shell', 'cd ' + ANDROID_WORK_DIR + '; (pm path jp.sji.sumatium.tool.screenorientation | ./busybox grep -qF package:) || (pm install ./ScreenOrientation.apk | ./busybox grep -xF Success) && (am 2>&1 | ./busybox grep -qF -- --user && am startservice -n jp.sji.sumatium.tool.screenorientation/.OrientationService -a ' + q.orientation + ' --user 0 || am startservice -n jp.sji.sumatium.tool.screenorientation/.OrientationService -a ' + q.orientation + ')'), function/*on_close*/(ret, stdout, stderr) {
          end(res, (ret !== 0 || stderr) ? (toErrSentence(stderr) || 'internal error') : stdout.match(/Starting service: Intent/i) ? 'OK' : (toErrSentence(stdout) || 'unknown error'));
        });
        break;
      default:
        end(res, 'bad request');
    }
    return ''; //just to avoid compiler warning

    function sendTouchEvent() {
      var x = (q.x * dev.w).toFixed();
      var y = (q.y * dev.h).toFixed();

      if (q.type === 'm' && dev.touchLast_x === x && dev.touchLast_y === y) { //ignore move event if at same position
        logIf(conf.logTouchCmdDetail, '[touch]ignore move event at same position');
        return;
      }

      var cmd = '';

      if (dev.touchMaxTrackId === 65535) {
        if (q.type === 'd') { //down
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x39 + ' 0; '; //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
          if (dev.touchNeedBtnTouchEvent) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 1 ' + 0x014a + ' 1; '; //BTN_TOUCH DOWN for sumsung devices
          }
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x30 + ' ' + dev.touchAvgContactSize + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
          if (dev.touchAvgPressure) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x3a + ' ' + dev.touchAvgPressure + '; '; //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
          } else if (dev.touchAvgFingerSize) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x32 + ' ' + dev.touchAvgFingerSize + '; '; //ABS_MT_WIDTH_MAJOR 0x32 /* Major axis of approaching ellipse */
          }
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x35 + ' ' + x + '; '; //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x36 + ' ' + y + '; '; //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
        }
        else if (q.type === 'm') { //move
          if (x !== dev.touchLast_x) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x35 + ' ' + x + '; '; //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
          }
          if (y !== dev.touchLast_y) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x36 + ' ' + y + '; '; //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
          }
        }
        else { //up, out
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x39 + ' -1; '; //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
          if (dev.touchNeedBtnTouchEvent) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 1 ' + 0x014a + ' 0; ';  //BTN_TOUCH UP for sumsung devices
          }
        }
        cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 0 0 0; '; //SYN_REPORT
      }
      else { //for some old devices such as galaxy SC-02B (android 2.2, 2.3)
        cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x39 + ' 0; '; //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
        cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x35 + ' ' + x + '; '; //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
        cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x36 + ' ' + y + '; '; //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
        if (q.type === 'd' || q.type === 'm') { //down, move
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x30 + ' ' + dev.touchAvgContactSize + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
          if (dev.touchAvgPressure) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x3a + ' ' + dev.touchAvgPressure + '; '; //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
          }
        } else { //up, out
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x30 + ' ' + 0 + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
          if (dev.touchAvgPressure) {
            cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 3 ' + 0x3a + ' ' + 0 + '; '; //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
          }
        }
        cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 0 2 0; '; //SYN_MT_REPORT   this is very important
        if (dev.touchNeedBtnTouchEvent && (q.type === 'd' || q.type === 'u' || q.type === 'o')) {
          cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 1 ' + 0x014a + ' ' + (q.type === 'd' ? 1 : 0) + '; '; //BTN_TOUCH DOWN for sumsung devices
        }
        cmd += '/system/bin/sendevent ' + dev.touchDevPath + ' 0 0 0; '; //SYN_REPORT
      }

      if (cmd !== '') {
        logIf(conf.logTouchCmdDetail, cmd, {head: '[touch]exec: '});
        dev.touchShellStdin.write(cmd + '\n');
      }

      if (q.type === 'd' || q.type === 'm') { //down, move
        dev.touchLast_x = x;
        dev.touchLast_y = y;
      }
    }
  } //end of handler(req, res)
} //end of startStreamWeb()

function startAdminWeb() {
  var httpServer, httpSeq = 0, _isAnyIp = isAnyIp(conf.adminWeb.ip), smark = (conf.adminWeb.ssl.on ? 's' : '');
  if (conf.adminWeb.ssl.on) {
    log('load SSL server certificate and private key from PKCS12 file: ' + conf.adminWeb.ssl.certificateFilePath);
    var options;
    try {
      options = {pfx: fs.readFileSync(conf.adminWeb.ssl.certificateFilePath)};
    } catch (err) {
      log('failed to read certificate file "' + conf.adminWeb.ssl.certificateFilePath + '". ' + stringifyError(err));
      process.exit(1);
      return;
    }
    httpServer = require('https').createServer(options, handler);
  } else {
    httpServer = require('http').createServer(handler);
  }
  httpServer.logHead = '[AdminWebSrv]';
  httpServer.on('error', function (err) {
    log(httpServer.logHead + stringifyError(err), {stderr: true});
    process.exit(1);
  });
  log(httpServer.logHead + 'listen on ' + ( _isAnyIp ? '*' : conf.adminWeb.ip) + ':' + conf.adminWeb.port);
  httpServer.listen(conf.adminWeb.port, _isAnyIp ? undefined : conf.adminWeb.ip, function/*on_complete*/() {
    log(httpServer.logHead + 'OK. You can start from http' + smark + '://' + (_isAnyIp ? 'localhost' : conf.adminWeb.ip) + ':' + conf.adminWeb.port + '/?adminKey=' + querystring.escape(conf.adminWeb.adminKey), {stderr: true});
  });

  function handler(req, res) {
    // set stream error handler to prevent from crashing
    res.on('error', function (err) {
      log((res.logHead || '[AdminHTTP' + smark.toUpperCase() + ' ' + res.req.url) + stringifyError(err));
    });
    if (req.url.length > 4096 || req.method !== 'GET' || req.url === '/favicon.ico') {
      return res.end();
    }
    var parsedUrl = url.parse(req.url, true/*querystring*/), q = parsedUrl.query;
    switch (parsedUrl.pathname) {
      case '/common.css':
      case '/rotatescale.css':
      case '/common.js':
      case '/jquery-2.0.3.js':
        res.setHeader('Content-Type', parsedUrl.pathname.match(re_extName)[0] === '.css' ? 'text/css' : 'text/javascript');
        return res.end(htmlCache[parsedUrl.pathname.slice(1)]);
        break;
    }
    if (conf.adminWeb.adminKey && q.adminKey !== conf.adminWeb.adminKey) {
      res.logHead = res.logHeadSimple = '[HTTP' + smark.toUpperCase() + '_' + (res.seq = ++httpSeq) + ']';
      logHttpRequest(req, res.logHeadSimple);
      res.statusCode = 403; //access denied
      res.setHeader('Content-Type', 'text/html');
      return end(res, htmlCache['login.html']);
    }

    switch (parsedUrl.pathname) {
      case '/status':
      case '/getLog':
        break;
      default :
        res.logHead = res.logHeadSimple = '[HTTP' + smark.toUpperCase() + '_' + (res.seq = ++httpSeq) + ']';
        logHttpRequest(req, res.logHeadSimple);
        res.on('close', function () { //closed without normal end(res,...)
          log(res.logHeadSimple + 'CLOSED by peer');
          res.__isClosed = true;
        });
        res.on('finish', function () { //response stream have been flushed and ended without log
          logIf(!res.__isEnded, res.logHeadSimple + 'END');
        });
    }

    setDefaultHttpHeader(res);

    switch (parsedUrl.pathname) {
      case '/deviceControl': //----------------------------control multiple devices-------------------------------------
        if (chkerrRequired('device[]', q.device)) {
          return end(res, chkerr);
        }
        q.device = uniqueNonEmptyArray(q.device);
        switch (q.action) {
          case 'setAccessKey': //----------------------------set access key for multiple devices------------------------
          case 'unsetAccessKey': //--------------------------unset access key for multiple devices----------------------
            if (q.action === 'setAccessKey' && chkerrRequired('accessKey', q.accessKey)) {
              return end(res, chkerr);
            }
            q.device.forEach(function (device) {
              getOrCreateDevCtx(device).accessKey = (q.action === 'setAccessKey' ? q.accessKey : '');
            });
            updateWholeUI();
            end(res, 'OK');
            break;
          case 'startRecording': //---------------------------start recording file for multiple devices-----------------
            if (chkerrCaptureParameter(q)) { //type, fps, scale, rotate
              return end(res, chkerr);
            }
            var okAry = [], errAry = [];
            q.device.forEach(function (device, i, devAry) {
              var _q = {};
              Object.keys(q).forEach(function (k) {
                _q[k] = q[k];
              });
              _q.device = device;
              startRecording(_q, function/*on_complete*/(err, wfile) {
                    if (err) {
                      errAry.push(devAry.length > 1 ? device + ': ' + err : err);
                    } else {
                      okAry.push((devAry.length > 1 ? device + ': OK: ' : 'OK: ') + wfile.filename);
                    }
                    if (errAry.length + okAry.length === devAry.length) { //loop completed, now write response
                      end(res, okAry.concat(errAry).join('\n'));
                    }
                  }
              );
            });
            break;
          case 'stopRecording': //----------------------------stop recording for multiple devices-----------------------
            q.device.forEach(function (device) {
              if (devMgr[device] && devMgr[device].liveStreamer) {
                forEachValueIn(devMgr[device].liveStreamer.consumerMap, function (res) {
                  if (res.filename) {
                    endCaptureConsumer(res, 'stop recording');
                  }
                });
              }
            });
            end(res, 'OK');
            break;
          case 'deleteRecordedFiles': //---------------------delete recorded files for multiple devices-----------------
          case 'deleteSavedImages': //--------------------------delete image files for multiple devices----------------------
            if (q.action === 'deleteRecordedFiles') {
              deleteFiles(q.device, {video: true});
            } else {
              deleteFiles(q.device, {image: true});
            }
            end(res, 'OK');
            break;
          default :
            return end(res, 'bad request');
        }
        break;
      case '/getDeviceLog':  //--------------------------------get internal log file------------------------------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        spawn('[GetDeviceLog]', conf.adb, conf.adbOption.concat('-s', q.device, 'shell', 'cat', ANDROID_ASC_LOG_PATH), function/*on_close*/(ret, stdout, stderr) {
          res.end(removeNullChar(stdout) || toErrSentence(stderr) || (ret !== 0 ? 'unknown error' : ''));
        }, {noLogStdout: true});
        break;
      case '/getDeviceCpuMemTop':  //--------------------------get device cpu memory usage -----------------------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        prepareDeviceFile(q.device, function/*on_complete*/(err) {
              if (err) {
                return end(res, err);
              }
              return spawn('[GetDeviceCpuMemTop]', conf.adb, conf.adbOption.concat('-s', q.device, 'shell', ANDROID_WORK_DIR + '/busybox', 'top', '-b', '-n', '1'), function/*on_close*/(ret, stdout, stderr) {
                res.end(removeNullChar(stdout) || toErrSentence(stderr) || (ret !== 0 ? 'unknown error' : ''));
              }, {noLogStdout: true});
            }
        );
        break;
      case '/downloadRawScreenshot':  //----------------------------download android screen raw screenshot--------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        prepareDeviceFile(q.device, function/*on_complete*/(err) {
              if (err) {
                return end(res, err);
              }
              res.setHeader('Content-Type', 'image/raw');
              res.setHeader('Content-Disposition', 'attachment;filename=' + q.qdevice + '~' + getTimestamp() + '.raw');

              var childProc = spawn('[RawCapture]', conf.adb, conf.adbOption.concat('-s', q.device, 'shell', 'cd', ANDROID_WORK_DIR, ';',
                  'sh', 'capture_raw.sh',
                  (conf.remoteLogAppend ? '2>>' : '2>'), ANDROID_ASC_LOG_PATH));

              childProc.stdout.on('data', function (buf) {
                convertCRLFToLF(childProc/*as context*/, devMgr[q.device].CrCount, buf).forEach(function (buf) {
                  write(res, buf);
                });
              });
              childProc.stderr.on('data', function (buf) {
                log(buf, {noNewLine: true, head: childProc.logHead});
                end(res, toErrSentence(buf.toString()));
              });
              childProc.on('error', function () {
                end(res, childProc.__err);
              });
              childProc.on('close', function () {
                end(res);
              });
              return ''; //just to avoid compiler warning
            }
        );
        break;
      case '/': //---------------------------------------show menu of all devices---------------------------------------
        q.fps = q.fps || conf.defaultFps || DEFAULT_FPS;
        q.type = q.type || 'ajpg';
        q.scale = (q.scale === undefined) ? '400xAuto' : q.scale;
        if (chkerrCaptureParameter(q)) {
          return end(res, chkerr);
        }
        prepareAllDevices(/*repeat*/false, /*forceReloadDevInfo*/conf.reloadDevInfo, /*forcePrepareFileTouchApk*/false, function/*on_gotAllRealDev*/(err, realDeviceList) {
          var html = htmlCache['menu.html']
                  .replace(/@adminKey\b/g, querystring.escape(conf.adminWeb.adminKey))
                  .replace(/#adminKey\b/g, htmlEncode(conf.adminWeb.adminKey || ''))
                  .replace(/@MIN_FPS\b/g, String(MIN_FPS))
                  .replace(/@MAX_FPS\b/g, String(MAX_FPS))
                  .replace(/@fps\b/g, q.fps)
                  .replace(/@scale\b/g, q.scale_origVal)
                  .replace(/@rotate\b/g, q.rotate)
                  .replace(new RegExp('<option value="' + q.rotate + '"', 'g'), '$& selected')  //set selected rotate angle
                  .replace(/@stream_web\b/g, 'http' + (conf.ssl.on ? 's' : '') + '://' + conf.ipForHtmlLink + ':' + conf.port)
                  .replace(/@streamWebIP\b/g, conf.ipForHtmlLink)
                  .replace(/@logStart\b/g, conf.logStart || -64000)
                  .replace(/@logEnd\b/g, conf.logEnd || '')
                  .replace(/@appVer\b/g, status.appVer)
                  .replace(/\bshowIfLocalFfmpeg\b/g, checkFfmpeg.success ? '' : 'style="display:none"')
                  .replace(/\bhideIfLocalFfmpeg\b/g, checkFfmpeg.success ? 'style="display:none"' : '')
                  .replace(/@latestFramesToDump\b/g, conf.latestFramesToDump || '')
              ;
          //set enable or disable of some config buttons for /var? command
          dynamicConfKeyList.forEach(function (k) {
            html = html.replace('@' + k + '_negVal', (conf[k] ? 'false' : 'true')).replace('#' + k + '_negBtn', (conf[k] ? 'Disable' : 'Enable'));
          });


          if (conf.adminWeb.adminKey) {
            res.setHeader('Set-Cookie', 'adminKey=' + querystring.escape(conf.adminWeb.adminKey) + '; HttpOnly');
          }
          res.setHeader('Content-Type', 'text/html');
          end(res, html.replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
            htmlBlock = htmlBlock || wholeMatch; //just to avoid compiler warning
            return Object.keys(devMgr).sort().reduce(function (joinedStr, device) {
              var dev = devMgr[device];
              var hasDevice = realDeviceList.indexOf(device) >= 0;
              return joinedStr + htmlBlock
                  .replace(/#devInfo\b/g, htmlEncode(dev.info))
                  .replace(/#devInfo_class\b/g, (dev.info ? '' : 'errorWithTip') + (hasDevice ? '' : ' disconnected'))
                  .replace(/#devErr\b/g, htmlEncode(hasDevice ? dev.err : (dev.err = 'error: device not found')))
                  .replace(/@device\b/g, querystring.escape(device))
                  .replace(/#device\b/g, htmlEncode(device))
                  .replace(/\$device\b/g, htmlIdEncode(device))
                  .replace(/#accessKey\b/g, htmlEncode(dev.accessKey || ''))
                  .replace(/@accessKey\b/g, querystring.escape(dev.accessKey || ''))
                  .replace(/#accessKey_disp\b/g, htmlEncode(dev.accessKey ? dev.accessKey : conf.adminWeb.adminKey ? '<None> Please "Set Access Key" for this device' : '<None>'))
                  .replace(/#styleName_AccessKey_disp\b/g, (dev.accessKey || !conf.adminWeb.adminKey) ? '' : 'errorWithTip')
                  ;
            }, ''/*initial joinedStr*/);
          }));
        });
        break;
      case '/stopServer':  //------------------------------------stop server management---------------------------------
        end(res, 'OK');
        log('stop on demand');
        httpServer.close();
        process.streamWeb.close();
        Object.keys(childProcPidMap).forEach(function (pid) {
          log('kill child process pid_' + pid);
          try {
            process.kill(pid, 'SIGKILL');
          } catch (err) {
            logIf(err.code !== 'ENOENT', 'failed to kill process pid_' + pid + '. ' + stringifyError(err));
          }
        });
        process.exit(0);
        break;
      case '/restartAdb':  //------------------------------------restart ADB--------------------------------------------
        log(httpServer.logHead + 'restart ADB');
        spawn('[StopAdb]', conf.adb, conf.adbOption.concat('kill-server'), function/*on_close*/(/*ret, stdout, stderr*/) {
          spawn('[StartAdb]', conf.adb, conf.adbOption.concat('start-server'), function/*on_close*/(/*ret, stdout, stderr*/) {
            end(res, 'OK');
          });
        });
        break;
      case '/reloadResource':  //-----------------------------reload resource file to cache-----------------------------
        loadResourceSync();
        end(res, 'OK');
        break;
      case '/var':  //------------------------------------------change some config var----------------------------------
        if (dynamicConfKeyList.some(function (k) {
          return chkerrOptional(k + '(optional)', q[k], ['true', 'false']);
        })) {
          return end(res, chkerr);
        }
        var changed = false;
        dynamicConfKeyList.forEach(function (k) {
          if (q[k]) {
            var newVal = (q[k] === 'true');
            if ((conf[k] ? true : false) !== newVal) {
              conf[k] = newVal;
              changed = true;
            }
          }
        });
        if (changed) {
          updateWholeUI();
        }
        end(res, 'OK');
        break;
      case '/useStreamWebIp':
        if (chkerrRequired('ip', q.ip)) {
          return end(res, chkerr);
        }
        q.ip = isAnyIp(q.ip) ? getFirstIp() : q.ip;
        if (conf.ipForHtmlLink !== q.ip) {
          conf.ipForHtmlLink = q.ip;
          updateWholeUI();
        }
        end(res, 'OK');
        break;
      case '/setAutoDumpLatestImages': //------------------------Keep Saving Latest N Frames----------------------------
        if (chkerrOptional('frames', (q.frames = Number(q.frames) || 0), 0, 1000)) {
          return end(res, chkerr);
        }
        if (conf.latestFramesToDump !== q.frames) {
          conf.latestFramesToDump = q.frames;
          updateWholeUI();
        }
        end(res, 'OK');
        break;
      case '/status':  //-----------------------------------push live capture status to browser-------------------------
        res.setHeader('Content-Type', 'text/json');
        res.previousVer = q.ver;
        res.previousAppVer = q.appVer;
        status.consumerMap[(res.consumerId = getTimestamp())] = res;
        res.on('close', function () { //closed without normal end(res,...)
          delete status.consumerMap[res.consumerId];
        });
        updateLiveCaptureStatusUI();
        break;
      case '/getLog':  //----------------------------------------get log------------------------------------------------
        var logFilePath = q.logDate === 'today' ? log.context.todayLogFilePath : log.context.yesterdayLogFilePath;
        var logStart, logEnd;
        if (q.logStart !== undefined && q.logStart !== '' && isNaN((logStart = Number(q.logStart)))) {
          return end(res, '`start`(optional) must be a number');
        }
        if (q.logEnd !== undefined && q.logEnd !== '' && isNaN((logEnd = Number(q.logEnd)))) {
          return end(res, '`end`(optional) must be a number');
        }
        if (q.logStart !== undefined) {
          conf.logStart = q.logStart;
        }
        if (q.logEnd !== undefined) {
          conf.logEnd = q.logEnd;
        }

        var logSize;
        try {
          logSize = fs.statSync(logFilePath).size;
        } catch (err) {
          return end(res, stringifyError(err));
        }
        if (logStart !== undefined) {
          if (logStart < 0 && (logStart += logSize) < 0) {
            logStart = 0;
          } else if (logStart > logSize) {
            logStart = logSize;
          }
        } else {
          logStart = 0;
        }
        if (logEnd !== undefined) {
          if (logEnd < 0 && (logEnd += logSize) < 0) {
            logEnd = 0;
          } else if (logEnd > logSize) {
            logEnd = logSize;
          }
        } else {
          logEnd = logSize;
        }
        if ((logSize = logEnd - logStart) <= 0) {
          return end(res);
        }

        if (q.logDownload === 'true') {
          res.setHeader('Content-Disposition', 'attachment;filename=' + Path.basename(logFilePath)); //remove dir part
        }
        res.setHeader('Content-Length', logSize);

        fs.createReadStream(logFilePath, {start: logStart, end: logEnd})
            .on('error',function (err) {
              end(res, stringifyError(err));
            }).pipe(res);
        break;
      case '/prepareAllDevices':  //-----------------------prepare device file/touchInfo/apk forcibly ------------------
        prepareAllDevices(/*repeat*/false, /*forceReloadDevInfo*/true, /*forcePrepareFileTouchApk*/true, /*on_gotAllRealDev*/null);
        end(res, 'OK');
        break;
      default:
        end(res, 'bad request');
    }
    return ''; //just to avoid compiler warning
  }
}

function getLocalToolFileHashSync() {
  return fs.readdirSync(UPLOAD_LOCAL_DIR).reduce(function (joinedStr, filename) {
    return joinedStr + require('crypto').createHash('sha1').update(fs.readFileSync(UPLOAD_LOCAL_DIR + '/' + filename)).digest('base64') + '_';
  }, ''/*initial joinedStr*/);
}

function loadResourceSync() {
  prepareDeviceFile.ver = getLocalToolFileHashSync();

  fs.readdirSync('./html').forEach(function (filename) {
    htmlCache[filename] = fs.readFileSync('./html/' + filename).toString();
  });

  //scan recorded files to get device serial numbers ever used
  var filenameAry;
  try {
    filenameAry = fs.readdirSync(conf.outputDir);
  } catch (err) {
    log('failed to check output dir "' + conf.outputDir + '". ' + stringifyError(err) + '. This dir can be set by "outputDir" setting in stream.json file', {stderr: true});
    process.exit(1);
    return;
  }
  filenameAry.forEach(function (filename) {
    var fname = new FilenameInfo(filename);
    if (fname.isValid) {
      getOrCreateDevCtx(fname.device);
    }
  });

  updateWholeUI();
}

function prepareAllDevices(repeat, forceReloadDevInfo, forcePrepareFileTouchApk, on_gotAllRealDev) {
  getAllDevInfo(function/*on_complete*/(err, deviceList) {
    if (on_gotAllRealDev) {
      on_gotAllRealDev(err, deviceList);
    }
    forEachValueIn(devMgr, function (dev) {
      if (deviceList.indexOf(dev.device) < 0) {
        if (dev.err !== 'error: device not found') {
          dev.err = 'error: device not found';
          updateWholeUI();
        }
      } else {
        if (forcePrepareFileTouchApk) {
          dev.didPrepare = false;
          dev.touchStatus = undefined;
        }
        prepareDeviceFile(dev.device, function/*on_complete*/() {
          if (forcePrepareFileTouchApk) {
            dev.touchStatus = undefined;
            dev.didTryInstallApk = false;
          }
          prepareTouchServer(dev);
          installApkOnce(dev);
        });
      }
    });
    if (repeat) {
      setTimeout(function () {
        prepareAllDevices(repeat, forceReloadDevInfo, forcePrepareFileTouchApk, on_gotAllRealDev);
      }, (conf.keepAdbAliveIntervalSeconds || 5 * 60) * 1000);
    }
  }, forceReloadDevInfo);
}

//check configuration
conf.adbOption = conf.adbOption || [];

loadResourceSync();

checkAdb(function/*on_complete*/() {
  checkFfmpeg(function/*on_complete*/() {
    startAdminWeb();
    startStreamWeb();
    prepareAllDevices(/*repeat*/true, /*forceReloadDevInfo*/true, /*forcePrepareFileTouchApk*/false, /*on_gotAllRealDev*/null);
  });
});


process.on('uncaughtException', function (err) {
  log('uncaughtException: ' + err + "\n" + err.stack);
  throw err;
});

if (1 === 0) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
  log({adb: 0, ffmpeg: 0, port: 0, ip: 0, ssl: 0, on: 0, certificateFilePath: 0, adminWeb: 0, outputDir: 0, protectOutputDir: 0, maxRecordTimeSeconds: 0, ffmpegDebugLog: 0, ffmpegStatistics: 0, remoteLogAppend: 0, logHttpReqDetail: 0, reloadDevInfo: 0, logImageDecoderDetail: 0, logImageDumpFile: 0, latestFramesToDump: 0, forceUseFbFormat: 0, ffmpegOption: 0, shadowRecording: 0, logTouchCmdDetail: 0,
    playerId: 0, range: 0, as: 0, asHtml5Video: 0, orientation: 0,
    action: 0, logDate: 0, logDownload: 0, keepAdbAliveIntervalSeconds: 0, defaultFps: 0, err: 0, x: 0, y: 0, stack: 0});
}

//todo: some device crashes if live view full image
//todo: sometimes ScreenshotClient::update just failed
//todo: screenshot buffer changed frequently, should lock
//todo: seems adb ignore SIGPIPE so sometimes it does not exit if parent node.js exit -> use socket to talk to 5037 directly
//todo: add audio
//todo: remove dependence of adb
