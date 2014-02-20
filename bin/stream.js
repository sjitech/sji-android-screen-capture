'use strict';
process.chdir(__dirname); //set dir of current file as working dir

//************************import module  *************************************************
var child_process = require('child_process'),
    fs = require('fs'),
    url = require('url'),
    querystring = require('querystring'),
    Path = require('path'),
    jsonFile = require('./node_modules/jsonFile.js'),
    logger = require('./node_modules/logger.js');

var conf = jsonFile.parse('./stream.json');
if (!process) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
  conf = {adb: '', ffmpeg: '', port: 0, ip: '', ssl: {on: false, certificateFilePath: ''}, adminWeb: {}, outputDir: '', maxRecordedFileSize: 0, ffmpegDebugLog: false, ffmpegStatistics: false, remoteLogAppend: false, logHttpReqAddr: false, reloadDevInfo: false, logImageDumpFile: false, logImageDecoderDetail: false, forceUseFbFormat: false, ffmpegOption: {}, tempImageLifeMilliseconds: 0, shadowRecordingFormat: ''};
}
var log = logger.create(conf ? conf.log : null);
log('===================================pid:' + process.pid + '=======================================');
if (!conf) {
  log(jsonFile.getLastError(), {stderr: true});
  process.exit(1);
}
log('use configuration: ' + JSON.stringify(conf, null, '  '));

//************************global var  ****************************************************
var MIN_FPS = 0.1, MAX_FPS = 40;
var UPLOAD_LOCAL_DIR = './android', ANDROID_WORK_DIR = '/data/local/tmp/sji-asc';
var MULTIPART_BOUNDARY = 'MULTIPART_BOUNDARY', MULTIPART_MIXED_REPLACE = 'multipart/x-mixed-replace;boundary=' + MULTIPART_BOUNDARY;
var CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = BUF_CR2.slice(0, 1);
var re_adbNewLineSeq = /\r?\r?\n$/; // CR LF or CR CR LF
var devMgr = {}; //key:device serial number, value:device info. See getOrCreateDevCtx()
var chkerr = ''; //for chkerrXxx() to save error info 
var htmlCache = {}; //key:filename
var status = { consumerMap: {}};
var overallCounterMap = {streaming: null, recording: null, recorded: {bytes: 0}, converting: null};
var recordingFileMap = {}; //key:filename
var childProcPidMap = {}; //key: pid
var videoTypeNameMap = {apng: 'Animated PNG', ajpg: 'Animated JPG', webm: 'WebM Video', mp4: 'MP4 H264 Video', ogg: 'Ogg Video'};
var videoTypeSet = {apng: 1, ajpg: 1, webm: 1};
var aimgTypeSet = {apng: 1, ajpg: 1}; //animated PNG or JPG
var imageTypeSet = {png: 1, jpg: 1};
var videoAndImageTypeAry = Object.keys(videoTypeSet).concat(Object.keys(imageTypeSet));
var imageFileCleanerTimer;
var lastImageMap = {}; //key: aimgDecoderIndex. value: {fileIndex:fileIndex, data:wholeImageBuf}
var dynamicConfKeyList = ['ffmpegDebugLog', 'ffmpegStatistics', 'remoteLogAppend', 'logHttpReqAddr', 'reloadDevInfo', 'logImageDumpFile', 'logImageDecoderDetail', 'forceUseFbFormat'];

//************************common *********************************************************
function getOrCreateDevCtx(device/*device serial number*/) {
  var dev;
  if (!(dev = devMgr[device])) {
    devMgr[device] = dev = {device: device};
    dev.counterMapRoot = {};
    videoAndImageTypeAry.forEach(function (type) {
      dev.counterMapRoot[type] = {};
    });
  }
  return dev;
}

function spawn(logHead, _path, args, on_close, opt) {
  log(logHead + 'spawn ' + _path + ' with args: ' + JSON.stringify(args));

  var childProc = child_process.spawn(_path, args);
  if (childProc.pid > 0) {
    childProcPidMap[childProc.pid] = true;
    childProc.logHead = logHead + '[pid_' + childProc.pid + ']';
    log(childProc.logHead + 'spawned');
  } else {
    log(childProc.logHead + 'spawn failed');
  }

  childProc.once('error', function (err) {
    if (err.code === 'ENOENT') {
      var hasDir = containsDir(_path);
      var hint = hasDir ? '' : ', Please use full path or add dir of file to `PATH` environment variable';
      err = 'Error ENOENT(file is not found' + (hasDir ? '' : ' in dir list defined by PATH environment variable') + '). File: ' + _path + hint;
    } else if (err.code === 'EACCES') {
      err = 'Error EACCES(file is not executable or you have no permission to execute). File: ' + _path;
    }
    log(childProc.logHead + (childProc.__spawnErr = err));
  });
  childProc.once('close', function (ret, signal) { //exited or failed to spawn
    log(childProc.logHead + 'exited: ' + (ret === null || ret === undefined ? '' : ret) + ' ' + (signal || ''));
    delete childProcPidMap[childProc.pid];
  });

  //if specified on_close callback, then wait process finished and get stdout,stderr output
  if (typeof(on_close) === 'function') {
    var stdoutBufAry = [];
    childProc.stdout.on('data', function (buf) {
      stdoutBufAry.push(buf);
      if (opt && opt.noLogStdout === true) {
        if (!childProc.didOmitStdout) {
          childProc.didOmitStdout = true;
          log(childProc.logHead + 'stdout output... omitted');
        }
      } else {
        log(buf, {noNewLine: true, head: childProc.logHead});
      }
    });
    var stderrBufAry = [];
    childProc.stderr.on('data', function (buf) {
      stderrBufAry.push(buf);
      log(buf, {noNewLine: true, head: childProc.logHead});
    });
    childProc.once('close', function (ret) { //exited or failed to spawn
      var stdout = Buffer.concat(stdoutBufAry).toString();
      stdoutBufAry = null;
      var stderr = Buffer.concat(stderrBufAry).toString();
      stderrBufAry = null;
      on_close(ret, stdout, stderr);
    });
  }
  else {
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

function htmlEncode(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function yyyymmdd_hhmmss_mmm(dt) {
  return dpad4(dt.getFullYear()) + dpad2(dt.getMonth() + 1) + dpad2(dt.getDate()) + '_' + dpad2(dt.getHours()) + dpad2(dt.getMinutes()) + dpad2(dt.getSeconds()) + '_' + dpad3(dt.getMilliseconds());
}

function nowStr() {
  var dt = new Date();
  if (dt.valueOf() === nowStr.dtMs) {
    nowStr.seq++;
  } else {
    nowStr.seq = 0;
    nowStr.dtMs = dt.valueOf();
  }
  return yyyymmdd_hhmmss_mmm(dt) + '_' + dpad3(nowStr.seq);
}
nowStr.LEN = nowStr().length;

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
  if (res.__bytesWritten === undefined) {
    log(res.logHead + 'start output......');
    res.__bytesWritten = 0;
  }
  res.__bytesWritten += dataStrOfBuf.length;

  if (res.filename) {
    (res.counter || {}).bytes += dataStrOfBuf.length; //set recording bytes counter per device/type
    overallCounterMap.recorded.bytes += dataStrOfBuf.length; //set recorded bytes counter overall
  } else {
    (overallCounterMap.streaming || {}).bytes += dataStrOfBuf.length; //set streaming bytes counter overall
  }

  res.write(dataStrOfBuf);

  if (res.filename) { //FileRecorder
    res.fileSize = (res.fileSize || 0) + dataStrOfBuf.length;
    if (res.fileSize >= conf.maxRecordedFileSize) {
      log(res.logHead + 'stop recording due to size too big (> ' + conf.maxRecordedFileSize + ' bytes)');
      end(res);
    }
  }
}

function end(res, dataStrOfBuf) {
  if (res.__isEnded || res.__isClosed) {
    return;
  }
  res.__isEnded = true;

  if (res.__bytesWritten) {
    dataStrOfBuf = '';
    if (res.logHead) {
      log(res.logHead + 'end. total ' + res.__bytesWritten + ' bytes written');
    }
  } else {
    if (res.setHeader && !res.headersSent) {
      if ((res.getHeader('Content-Type') || '').slice(0, 5) !== 'text/') {
        res.setHeader('Content-Type', 'text/plain');
      }
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition');
    }
    if (res.logHead) {
      var s = dataStrOfBuf === undefined ? '' : String(dataStrOfBuf).replace(/\n[ \t]*/g, ' ');
      log(res.logHead + 'end' + (s ? (' with data: ' + (s.length > 50 ? s.slice(0, 50) + '...' : s)) : ''));
    }
  }

  res.end(dataStrOfBuf);
}

function isAnyIp(ip) {
  return !ip || ip === '0.0.0.0' || ip === '*';
}

function containsDir(filename) {
  return ((process.platform === 'win32') ? /\/\\/ : /\//).test(filename);
}

function searchInPath(filename) {
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
//****************************************************************************************

function checkAdb(on_complete) {
  log('[CheckAdb]Full path of "Android Debug Bridge" is "' + searchInPath(conf.adb) + '"');
  spawn('[CheckAdb]', conf.adb, ['version'],
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr) {
          log('Failed to check "Android Debug Bridge". Please check log', {stderr: true});
          process.exit(1);
        } else {
          on_complete();
        }
      });
}

function checkFfmpeg(on_complete) {
  log('[CheckFfmpeg]Full path of FFMPEG is "' + searchInPath(conf.ffmpeg) + '"');
  spawn('[CheckFfmpeg]', conf.ffmpeg, ['-version'],
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr) {
          log('Failed to check FFMPEG (for this machine, not for Android device).' +
              ' You will not be able to convert recorded video to other format.' +
              ' Please install it from "http://www.ffmpeg.org/download.html". Please check log', {stderr: true});
        } else {
          checkFfmpeg.success = true;
        }
        on_complete();
      });
}

function getAllDev(on_complete) {
  spawn('[GetAllDevices]', conf.adb, ['devices'],
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr) {
          return on_complete(toErrSentence(stderr) || 'unknown error: failed to get all connected devices', []);
        }
        var deviceList = [], parts;
        stdout.split('\n').slice(1/*from second line*/).forEach(function (lineStr) {
          if ((parts = lineStr.split('\t')).length > 1) {
            deviceList.push(parts[0]);
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
function getDevInfo(device, on_complete, timeoutMs) {
  if (!conf.reloadDevInfo && devMgr[device] && devMgr[device].info) {
    on_complete('', devMgr[device].info);
    return;
  }
  var childProc = spawn('[GetDevInfo]', conf.adb, ['-s', device, 'shell', 'echo', '`'].concat(ADB_GET_DEV_INFO_CMD_ARGS).concat('`'),
      function  /*on_close*/(ret, stdout, stderr) {
        clearTimeout(childProc.myTimer);
        on_complete('', (ret === 0 && !stderr) ? stdout.replace(re_adbNewLineSeq, '') : '');
      }
  );
  if (childProc.pid) {
    childProc.myTimer = setTimeout(function () {
      log(childProc.logHead + 'kill due to timeout');
      childProc.kill();
    }, timeoutMs);
  }
}

function getAllDevInfo(on_complete) {
  getAllDev(function/*on_complete*/(err, deviceList) {
    if (err) {
      on_complete(err);
      return;
    }
    var infoList = [];
    (function get_next_device_info() {
      if (infoList.length < deviceList.length) {
        getDevInfo(deviceList[infoList.length],
            function/*on_complete*/(err, info) {
              infoList.push(info);
              get_next_device_info();
            },
            1000/*timeoutMs*/);
      } else {
        on_complete('', deviceList, infoList);
      }
    })();
  });
}

/*
 * upload all necessary files to android
 */
function prepareDeviceFile(device, on_complete) {
  if (devMgr[device] && devMgr[device].didPrepare) {
    on_complete();
    return;
  }
  spawn('[CheckDevice ' + device + ']', conf.adb, ['-s', device, 'shell', 'echo', '`'].concat(ADB_GET_DEV_INFO_CMD_ARGS).concat(
      'echo', '====;', 'cat', ANDROID_WORK_DIR + '/version', '2>', '/dev/null',
      '`'),
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr || !stdout) {
          on_complete(toErrSentence(stderr) || 'unknown error: failed to check device');
        } else {
          var stdoutNoCRLF = stdout.replace(re_adbNewLineSeq, '');
          var parts = stdoutNoCRLF.split('====');
          var _ver = parts[1].trim(); //get remote version file content

          var dev = getOrCreateDevCtx(device);
          dev.info = parts[0].trim(); //save device info for later use
          // BTW, detect new line sequence returned by adb, Usually CrCount=0 (means need not convert), But for Windows OS, at least=1
          dev.CrCount = (stdout.length - stdoutNoCRLF.length) - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/;

          //compare to local version
          if (_ver === prepareDeviceFile.ver) {
            dev.didPrepare = true;
            on_complete();
          } else {
            spawn('[PushFileToDevice ' + device + ']', conf.adb, ['-s', device , 'push', UPLOAD_LOCAL_DIR, ANDROID_WORK_DIR],
                function /*on_close*/(ret, stdout, stderr) {
                  if (ret !== 0) {
                    on_complete(toErrSentence(stderr) || 'unknown error: failed to prepare device file');
                  } else {
                    spawn('[UpdateFileOnDevice ' + device + ']', conf.adb, ['-s', device, 'shell', 'chmod', '755', ANDROID_WORK_DIR + '/*', '&&',
                      'echo', prepareDeviceFile.ver, '>', ANDROID_WORK_DIR + '/version'],
                        function /*on_close*/(ret, stdout, stderr) {
                          if (ret !== 0 || stdout || stderr) {
                            on_complete(toErrSentence(stderr) || 'unknown error: failed to finish preparing device file');
                          } else {
                            dev.didPrepare = true;
                            on_complete();
                          }
                        });
                  }
                });
          }
        }
      });
}

function chkerrCaptureParameter(q) {
  if (chkerrRequired('type', q.type, videoAndImageTypeAry) ||
      videoTypeSet[q.type] && chkerrRequired('fps', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS) ||
      imageTypeSet[q.type] && (q.fps = 0) && false ||
      chkerrOptional('rotate(optional)', (q.rotate = Number(q.rotate)), [0, 90, 270])) {
    return chkerr;
  }
  var n, match;
  if (q.scale) {
    if (!isNaN((n = Number(q.scale)))) { //can convert to a valid number
      if (chkerrRequired('scale(optional) in number format', (q.scale = n), 0.1/*min*/, 1/*max*/)) {
        return chkerr;
      }
    } else { //treat as string format 9999x9999
      if (!(match = (q.scale = String(q.scale)).match(/^(\d{0,4})x(\d{0,4})$/)) || !match[1] && !match[2]) {
        return setchkerr('scale(optional) in string format must be in pattern "9999x9999" or "9999x" or "x9999"');
      }
      q.scale_w = match[1] ? Number(match[1]) : 0;
      q.scale_h = match[2] ? Number(match[2]) : 0;
      if (!q.scale_w && !q.scale_h) {
        q.scale = '';
      }
    }
  }
  q.scale = q.scale === 1 ? '' : q.scale ? q.scale : '';
  q.rotate = q.rotate || '';
  return '';
}

function stringifyCaptureParameter(q, format /*undefined, 'filename'*/) {
  var fps_scale_rotate = '';
  if (q.fps) {
    fps_scale_rotate += 'f' + q.fps;
  }
  if (q.scale) {
    if (typeof(q.scale) === 'number') {
      fps_scale_rotate += 's' + q.scale;
    } else if (q.scale_w) {
      fps_scale_rotate += 'w' + q.scale_w;
    } else if (q.scale_h) {
      fps_scale_rotate += 'h' + q.scale_h;
    }
  }
  if (q.rotate) {
    fps_scale_rotate += 'r' + q.rotate;
  }

  if (format === 'filename') {
    return querystring.escape(q.device) + '~' + q.type + '~' + fps_scale_rotate + '~' + nowStr();
  }
  return q.device + '~' + q.type + '~' + fps_scale_rotate;
}

/**
 * Capture screen, send result to output stream 'res'. Maybe multiple output stream share a single capture process.
 * Please call chkerrCaptureParameter before this function.
 * @param outputStream result stream (e.g. HTTP response or file stream)
 * @param q option, Must have been checked by !chkerrCaptureParameter(q)
 *  {
      device : device serial number
      type:    'apng', 'ajpg', 'webm', 'png', 'jpg'
      fps:     [optional] rate for apng, ajpg, webm. Must be in range MIN_FPS~MAX_FPS
      scale:   [optional] 0.1 - 1 or string in format 9999x9999 or 9999x or x9999
      rotate:  [optional] 0, 90, 270
    }
 */
function capture(outputStream, q) {
  var res = outputStream, dev = getOrCreateDevCtx(q.device), provider;

  function createCaptureProvider() {
    createCaptureProvider.called = true;
    return {consumerMap: {}, lastConsumerId: 0, dev: dev, type: q.type, fps: q.fps, scale: q.scale, rotate: q.rotate,
      logHead: '[Capture ' + stringifyCaptureParameter(q, 'log') + ']'};
  }

  function didOutput(consumerId, consumerMap) {
    return consumerMap[consumerId].__bytesWritten > 0;
  }

  if (imageTypeSet[q.type]) {
    //for single image, it is light process, so let it coexistent with existing capture.
    provider = createCaptureProvider();
  } else if (dev.liveStreamer) { //there is an existing capture running or preparing
    if (dev.liveStreamer.type !== q.type || dev.liveStreamer.fps !== q.fps || dev.liveStreamer.scale !== q.scale || dev.liveStreamer.rotate !== q.rotate ||
        !aimgTypeSet[dev.liveStreamer.type] && (Object.keys(dev.liveStreamer.consumerMap).some(didOutput))) {
      forEachValueIn(dev.liveStreamer.consumerMap, endCaptureConsumer, 'another live streamer is going to run');
      provider = dev.liveStreamer = createCaptureProvider();
    } else { //share existing stream provider (Animated PNG,JPG or webm if have not output yet)
      provider = dev.liveStreamer;
      if (res.filename) { //stop other unrelated recording
        forEachValueIn(dev.liveStreamer.consumerMap, function (_res) {
          if (_res.filename && res.filename.slice(0, _res.filename.length) === _res.filename) {
            endCaptureConsumer(_res, 'start another recording');
          }
        });
      }
    }
  } else { //there is no existing capture running or preparing
    provider = dev.liveStreamer = createCaptureProvider();
  }

  /*
   * add consumer
   */
  res.captureProvider = provider;
  res.consumerId = ++provider.lastConsumerId;
  provider.consumerMap[res.consumerId] = res;
  res.logHead = res.logHead.slice(0, -1) + ' @ ' + provider.logHead.slice(1, -1) + ']';
  log(res.logHead + 'added');
  updateCounter(q.device, q.type, +1, res/*ownerOutputStream*/);

  if (res.setHeader) {
    res.setHeader('Content-Type', aimgTypeSet[q.type] ? MULTIPART_MIXED_REPLACE : imageTypeSet[q.type] ? 'image/' + q.type : 'video/' + q.type);
  }
  res.on('close', function () { //http connection is closed without normal end(res,...) or file is closed
    endCaptureConsumer(res, 'closed'/*do not change this string*/);
  });

  if (!createCaptureProvider.called) {
    log(res.logHead + 'use existing capture process ' + (provider.pid ? 'pid_' + provider.pid : '?(still in preparing)'));
  } else {
    prepareDeviceFile(q.device, function /*on_complete*/(err) {
          if (Object.keys(provider.consumerMap).length === 0) {
            return; //abort
          } else if (err) {
            forEachValueIn(provider.consumerMap, endCaptureConsumer, err);
            return;
          }
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
          if (q.scale || q.rotate) {
            var filter = '';
            if (typeof(q.scale) === 'number') {
              filter += ',scale=iw*' + q.scale + ':-1';
            } else {
              filter += ',scale=' + (q.scale_w || '-1') + ':' + (q.scale_h || '-1');
            }
            if (q.rotate === 90) {
              filter += ',transpose=1';
            } else if (q.rotate === 270) {
              filter += ',transpose=2';
            }

            if (filter) {
              FFMPEG_PARAM += ' -vf ' + filter.slice(1/*remove first comma*/);
            }
          }
          if (q.type === 'webm') { //webm video
            FFMPEG_PARAM += ' -f webm -vcodec libvpx -rc_lookahead 0';
          } else if (q.type === 'apng') { //animated png image
            FFMPEG_PARAM += ' -f image2 -vcodec png -update 1';
          } else if (q.type === 'ajpg') { //animated jpg image
            FFMPEG_PARAM += ' -f image2 -vcodec mjpeg -update 1 -q:v 1';
          } else if (q.type === 'png') {    //single png image
            FFMPEG_PARAM += ' -f image2 -vcodec png -vframes 1';
          } else if (q.type === 'jpg') {    //single jpg image
            FFMPEG_PARAM += ' -f image2 -vcodec mjpeg -vframes 1 -q:v 1';
          } else {
            log('unknown type');
          }
          FFMPEG_PARAM += ' ' + opt.out + ' -'; //means output to stdout
          /*
           * ------------------------------------start new capture process ---------------------------------------------
           */
          var childProc = spawn(provider.logHead, conf.adb, ['-s', q.device, 'shell', 'cd', ANDROID_WORK_DIR, ';',
            'sh', './capture.sh',
            conf.forceUseFbFormat ? 'forceUseFbFormat' : 'autoDetectFormat',
            q.fps, FFMPEG_PARAM,
            (conf.remoteLogAppend ? '2>>' : '2>'), ANDROID_WORK_DIR + '/log']);

          if (childProc.pid > 0) {
            provider.pid = childProc.pid;

            if (aimgTypeSet[provider.type]) { //for apng, ajpg
              provider.aimgDecoder = aimgCreateContext(q.device, provider.type);
            }

            childProc.stdout.on('data', function (buf) {
              convertCRLFToLF(provider/*context*/, dev.CrCount, buf).forEach(function (buf) {
                if (aimgTypeSet[provider.type]) { //broadcast animated image to multiple client
                  aimgDecode(provider.aimgDecoder, provider.consumerMap, buf, 0, buf.length);
                } else {
                  forEachValueIn(provider.consumerMap, write, buf);
                }
              });
            });
            childProc.stderr.on('data', function (buf) {
              log(buf, {noNewLine: true, head: childProc.logHead});
              forEachValueIn(provider.consumerMap, endCaptureConsumer, toErrSentence(buf.toString()));
            });
          }

          childProc.on('close', function () { //exited or failed to spawn
            if (provider.aimgDecoder) {
              delete lastImageMap[provider.aimgDecoder.id];
            }
            if (provider === dev.liveStreamer) {
              log(provider.logHead + 'detach live streamer');
              dev.liveStreamer = null;
            }
            forEachValueIn(provider.consumerMap, endCaptureConsumer, childProc.didGetStdoutData ? '' : 'capture process had internal error, exited without any output');
          });
        }
    ); //end of prepareDeviceFile
  }
}

function endCaptureConsumer(res/*Any Type Output Stream*/, reason) {
  var provider;
  if (!res || !(provider = res.captureProvider).consumerMap[res.consumerId]) {
    return; //if not exist in consumerMap, do nothing. This can prevent endless loop of error event of the output stream
  }
  log(res.logHead + 'cleanup' + (reason ? (' due to ' + reason) : ''));

  delete provider.consumerMap[res.consumerId];
  updateCounter(provider.dev.device, provider.type, -1, res/*ownerOutputStream*/);

  end(res, reason);
  if (res.filename && res.close) {
    res.close();
  }

  endCaptureConsumer(provider.consumerMap[res.childConsumerId], 'parent consumer is closed');

  if (provider === provider.dev.liveStreamer && Object.keys(provider.consumerMap).length === 0) {
    if (provider.pid) {
      log(provider.logHead + 'kill this live streamer process pid_' + provider.pid + ' due to no more consumer');
      try {
        process.kill(provider.pid);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          log('failed to kill process pid_' + provider.pid + '. ' + stringifyError(err));
        }
      }
    }
    log(provider.logHead + 'detach this live streamer');
    provider.dev.liveStreamer = null;
  }
}

function startRecording(q/*same as capture*/, on_complete) {
  prepareDeviceFile(q.device, function /*on_complete*/(err) {
        if (err) {
          on_complete(err);
          return;
        }
        var filename = stringifyCaptureParameter(q, 'filename');
        var wfile = fs.createWriteStream(conf.outputDir + '/' + filename);
        wfile.filename = filename;
        wfile.logHead = '[FileWriter(Record) ' + filename + ']';

        wfile.on('open', function () {
          log(wfile.logHead + 'opened for write');
          recordingFileMap[filename] = true;
          capture(wfile, q); //---------do capture, save output to wfile----------
          callbackOnce('', wfile);
        });
        wfile.on('close', function () { //file's 'close' event will always be fired. If have pending output, it will be fired after 'finish' event which means flushed.
          wfile.__isClosed = true;
          log(wfile.logHead + 'closed');
          delete recordingFileMap[filename];
          callbackOnce('recording is stopped'); //do not worry, normally 'open' event handler have cleared this callback
        });
        wfile.on('error', function (err) {
          log(wfile.logHead + stringifyError(err));
          callbackOnce(err.code === 'ENOENT' ? 'error: output dir not found' : 'file operation error ' + err.code);
        });
        /*
         *-------------------on-fly convert to other format-------------------------------------------------------------
         *  shadow recording will be stopped if owner recording is stopped
         */
        if (checkFfmpeg.success && conf.shadowRecordingFormat && conf.shadowRecordingFormat !== q.type) {
          wfile.childConsumerId = convertOnRecording(q, filename, conf.shadowRecordingFormat);
        }
      }
  );

  function callbackOnce(err, wfile) {
    if (on_complete) {
      on_complete(err, wfile);
      on_complete = null;
    }
  }
}

function convertOnRecording(q, origFilename, newType) {
  var newFilename = origFilename + '.' + newType;
  var logHead = '[Converter(live ' + q.type + ' -> ' + newFilename + ')]';
  var args = makeConverterParameter(null, newFilename, q.type, q.fps, newType);
  /*
   * ------------------------------------start new converter process -------------------------------------------
   */
  var childProc = spawn(logHead, conf.ffmpeg, args, function/*on_close*/(ret) {
    log(logHead + (ret === 0 ? 'complete' : 'failed due to ' + (childProc.__spawnErr || 'internal error')));
    if (childProc.pid > 0) {
      childProc.stdin.__isClosed = true;
      delete recordingFileMap[newFilename];
    }
  });
  if (childProc.pid > 0) {
    childProc.stdin.filename = newFilename;
    childProc.stdin.logHead = '[FileWriter(Record)' + newFilename + ')]';
    childProc.stdin.on('error', function (err) {
      log(childProc.stdin.logHead + stringifyError(err));
    });
    recordingFileMap[newFilename] = true;
    capture(childProc.stdin, q); //---------do capture, save output to childProc.stdin----------
    return childProc.stdin.consumerId;
  }
  return null;
}

function convertRecordedFile(origFileName, newFilename, origType, origFps, newType, on_complete) {
  var logHead = '[Converter (' + origFileName + ' -> *.' + newType + ')]';
  if (recordingFileMap[origFileName] || !fs.existsSync(conf.outputDir + '/' + origFileName)) {
    log(logHead + (recordingFileMap[origFileName] ? 'error: file in recording' : 'error: file not found'));
    on_complete('error: file not found');
    return null;
  }
  var waiter = {}; //also serve as fake owner stream
  waiter.id = nowStr();
  waiter.callback = on_complete;
  waiter.newFilename = newFilename; //.filename is needed by updateCounter
  waiter.device = origFileName.split('~')[0];
  waiter.origType = origType; //owner type

  if (recordingFileMap[newFilename]) { //converter process is running
    recordingFileMap[newFilename].waiterMap[waiter.id] = waiter;
    log(logHead + 'use existing converter');
    return waiter;
  }

  var args = makeConverterParameter(origFileName, newFilename, origType, origFps, newType);
  /*
   * ------------------------------------start new converter process -------------------------------------------
   */
  var childProc = spawn(logHead, conf.ffmpeg, args, function/*on_close*/(ret) {
    log(logHead + (ret === 0 ? 'complete' : (childProc.__spawnErr || 'internal error')));
    if (childProc.pid > 0 && recordingFileMap[newFilename]) {
      recordingFileMap[newFilename].pid = 0; //means normally end converting
      var err = ret === 0 ? '' : 'converter have internal error';
      forEachValueIn(recordingFileMap[newFilename].waiterMap, endConverterWaiter, err);
    }
  });
  if (childProc.pid > 0) {
    var converter = {};
    recordingFileMap[newFilename] = converter;
    converter.pid = childProc.pid;
    converter.waiterMap = {};
    converter.waiterMap[waiter.id] = waiter;
    converter.convertedSize = 0;
    converter.updateRecordedBytes = function () {
      var stats, deltaSize;
      try {
        stats = fs.statSync(conf.outputDir + '/' + newFilename);
      } catch (err) {
        return;
      }
      deltaSize = stats.size - converter.convertedSize;
      converter.convertedSize = stats.size; //set recording bytes counter per device/type
      overallCounterMap.recorded.bytes += deltaSize; //set recorded bytes counter overall
    };
    converter.timerToUpdateRecordedBytes = setInterval(converter.updateRecordedBytes, 1000);

    updateCounter(waiter.device, origType, +1, waiter);

    return waiter;
  } else {
    on_complete(childProc.__spawnErr);
    return null;
  }
}

function endConverterWaiter(waiter, err) {
  var converter, waiterMap;
  if (!(converter = recordingFileMap[waiter.newFilename]) || !(waiterMap = converter.waiterMap) || !waiterMap[waiter.id]) {
    return;
  }
  waiter.callback(err);
  delete waiterMap[waiter.id];

  updateCounter(waiter.device, waiter.origType, -1, waiter);

  if (Object.keys(waiterMap).length === 0) {
    delete recordingFileMap[waiter.newFilename];
    clearInterval(converter.timerToUpdateRecordedBytes);

    converter.updateRecordedBytes();

    if (converter.pid > 0) {
      log('kill converter process pid_' + converter.pid + ' to abort converting');
      try {
        process.kill(converter.pid);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          log('failed to kill process pid_' + converter.pid + '. ' + stringifyError(err));
        }
      }
      log('delete "' + conf.outputDir + waiter.newFilename + '" to abort converting');
      try {
        fs.unlinkSync(conf.outputDir + '/' + waiter.newFilename);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          log('failed to delete "' + conf.outputDir + waiter.newFilename + '". ' + stringifyError(err));
        }
        return;
      }
      overallCounterMap.recorded.bytes -= converter.convertedSize;
      pushStatus();
    }
  }
}

function makeConverterParameter(filename, newFilename, type, fps, newType) {
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
  if (type === 'apng') {
    args.push('-f', filename ? 'image2' : 'image2pipe', '-vcodec', 'png');
  } else if (type === 'ajpg') {
    args.push('-f', 'mjpeg', '-vcodec', 'mjpeg');
  } else if (type === 'webm') {
    args.push('-f', 'webm', '-vcodec', 'libvpx');
  }
  args.push('-r', fps); //rate
  args.push('-i', filename ? (conf.outputDir + '/' + filename) : '-'); //from file or stdin
  //------------------------now make output parameters------------------------
  if (newType === 'mp4') {
    args.push('-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2'); //w, h to even integer. Because Odd w, h cause error!
  }
  args.push(conf.outputDir + '/' + newFilename);
  return args;
}

/**
 * Play or download recorded video file
 * must have been checked by !chkerrPlayRecordedFileParameter(q)
 * @param httpOutputStream
 * @param q option
 *  {
 *    device:  device serial number
      type:    'apng', 'ajpg', 'webm'
      fileIndex: [optional]
                [Absolute file index string]: result of /deviceControl?action=startRecording command.
                   Sample: "f4w300~20140219_101855_133_000.webm"
                [Relative file index number]: Bigger number means older file. E.g. 1 means 1 generation older file.
                   Sample: 0, 1, ...
      fps:     [optional] rate for apng, ajpg only. Must be in range MIN_FPS~MAX_FPS
    }
 * @param forDownload  true/false
 * @param range [optional] {start:?, end:?}
 * @param __fileIndex_checked [optional] internal flag
 * @param __file_checked [optional] internal flag
 */
function playOrDownloadRecordedFile(httpOutputStream, q, forDownload/*optional*/, range, __fileIndex_checked/*internal*/, __file_checked/*internal*/) {
  var res = httpOutputStream, filename, absFileIndex;
  /*
   * get file name by fileIndex or first recorded file of the type
   */
  if (!__fileIndex_checked) {
    var relFileIndex;
    if ((relFileIndex = Number(q.fileIndex || 0)) >= 0) {
      return findFiles(q.device, q.type, function /*on_complete*/(err, filenameAry) {
        if (err || !(filename = filenameAry[relFileIndex])) {
          return end(res, err || 'error: file not found');
        }
        q.fileIndex = filename.slice(querystring.escape(q.device).length + 1 + q.type.length + 1); //strip SN~type~
        return playOrDownloadRecordedFile(res, q, forDownload, range, true/*__fileIndex_checked*/, false/*file not checked*/);
      });
    }
  }
  absFileIndex = q.fileIndex;
  filename = querystring.escape(q.device) + '~' + q.type + '~' + absFileIndex;
  if (recordingFileMap[filename] && !__file_checked) {
    return end(res, 'error: file in recording');
  }

  var origFps = absFileIndex.match(/^f([0-9.]+)/);
  if (!origFps || chkerrRequired('fps', (origFps = Number(origFps[1])), MIN_FPS, MAX_FPS)) {
    return end(res, 'bad `fileIndex`');
  }
  q.fps = q.fps || origFps;

  var realType = absFileIndex.match(/\.(\w+)$/); //get extension name
  realType = realType ? realType[1] : q.type;

  var origFilename = filename.replace(/\.(\w+)$/, ''); //remove extension name

  var stats;
  try {
    stats = fs.statSync(conf.outputDir + '/' + filename);
  } catch (err) {
    if (err.code === 'ENOENT' && realType !== q.type && !__file_checked) {
      /*
       * ------------------ convert format if does not exists ------------------------
       */
      var waiter = convertRecordedFile(origFilename, filename, q.type, origFps, realType, function/*on_complete*/(err) {
        if (err) {
          end(res, err);
        } else { //-----------------------when conversion succeed, do playOrDownloadRecordedFile-----------------------
          playOrDownloadRecordedFile(res, q, forDownload, range, true/*__fileIndex_checked*/, true/*__file_checked*/);
        }
      });
      if (waiter) {
        res.on('close', function () { //http connection is closed without normal end(res,...)
          endConverterWaiter(waiter, 'owner http connection is closed by peer');
        });
      }
    } else {
      end(res, err.code === 'ENOENT' ? 'error: file not found' : 'file operation error ' + err.code);
    }
    return '';
  }
  if (!stats.size) {
    return end(res, 'error: file is empty');
  }
  /*
   * ------------------ support partial data request ---------------------
   */
  if ((!forDownload && aimgTypeSet[realType])) {
    range = undefined;
  } else {
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      range.start = Math.min(Math.max(Number(range.start), 0), stats.size) || 0;
      range.end = Math.min(Math.max(Number(range.end), range.start), stats.size) || stats.size;
      if (range.start === 0 && range.end === stats.size) {
        range = undefined;
      }
    }
    if (range) {
      res.setHeader('Content-Range', 'bytes ' + range.start + '-' + (range.end - 1) + '/' + stats.size);
      res.setHeader('Content-Length', range.end - range.start);
    } else {
      res.setHeader('Content-Length', stats.size);
    }
  }
  /*
   * ------------------ now open file ---------------------
   */
  var rfile = fs.createReadStream(conf.outputDir + '/' + filename, range);
  rfile.logHead = '[FileReader(' + (forDownload ? 'Download' : 'Play') + ' ' + filename + ']';
  res.logHead = res.logHead.slice(0, -1) + ' @ ' + rfile.logHead.slice(1, -1) + ']';

  rfile.on('open', function () {
    log(rfile.logHead + 'opened for read');
    res.setHeader('Content-Type', (!forDownload && aimgTypeSet[realType]) ? MULTIPART_MIXED_REPLACE : 'video/' + realType);
    if (forDownload) {
      res.setHeader('Content-Disposition', 'attachment;filename=asc~' + filename.replace(/\.\w+$/, '') + '.' + realType);
    } else if (aimgTypeSet[realType]) {
      rfile.aimgDecoder = aimgCreateContext(q.device, realType, q.playerId);
      rfile.aimgDecoder.fromFrame = Number(q.fromFrame);
      rfile.startTimeMs = Date.now();
    } else {
      if (range) {
        res.writeHead(206); //Partial Content
      }
    }
    updateCounter(q.device, q.type, +1, res/*ownerOutputStream*/);

    rfile.on('data', function (buf) {
      if (forDownload) {
        write(res, buf);
      } else if (aimgTypeSet[realType]) { //play apng, ajpg specially, translate it to multipart output
        rfile.aimgDecoder.isLastBuffer = (stats.size -= buf.length) === 0;
        aimgDecode(rfile.aimgDecoder, [res], buf, 0, buf.length, fnDecodeRest);
      } else { //for normal video, just write content
        write(res, buf);
      }

      function fnDecodeRest(pos/*rest data start position*/) {
        rfile.pause();
        rfile.timer = setTimeout(function () {
          rfile.resume();
          rfile.timer = null;
          aimgDecode(rfile.aimgDecoder, [res], buf, pos, buf.length, fnDecodeRest);
        }, Math.max(1, (rfile.startTimeMs + rfile.aimgDecoder.frameIndex * 1000 / q.fps) - Date.now()));
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
    updateCounter(q.device, q.type, -1, res/*ownerOutputStream*/);
    if (rfile.aimgDecoder) {
      delete lastImageMap[rfile.aimgDecoder.id];
      delete lastImageMap[rfile.aimgDecoder.id2];
    }
  });
  res.on('finish', function () { //data have been flushed. This event is not related with 'close' event
    updateCounter(q.device, q.type, -1, res/*ownerOutputStream*/);
  });
  return ''; //just to avoid compiler warning
}

function findFiles(deviceOrAry/*optional*/, typeOrAry/*optional*/, on_complete) {
  var devAry = !deviceOrAry ? null : Array.isArray(deviceOrAry) ? deviceOrAry : [deviceOrAry];
  var typeAry = !typeOrAry ? null : Array.isArray(typeOrAry) ? typeOrAry : [typeOrAry];
  var findVideo, findImage;
  if (typeAry) {
    findVideo = videoTypeSet[typeAry[0]];
    findImage = !findVideo;
  }

  fs.readdir(conf.outputDir, function (err, filenameAry) {
    if (err) {
      log('readdir ' + stringifyError(err));
      return on_complete(err.code === 'ENOENT' ? 'error: output dir not found' : 'file operation error ' + err.code, []);
    }

    filenameAry = filenameAry.filter(function (filename) {
      var parts, device, type;
      if (findVideo) {
        parts = filename.split('~');
        if (parts.length !== 4) {
          return false;
        }
        if (recordingFileMap[filename]) {
          return false;
        }
        device = querystring.unescape(parts[0]);
        type = parts[1];
      }
      else if (findImage) {
        var match = filename.match(/^([^~]+)~\w{4}Decoder\d{8}_\d{6}_\d{3}_\d{3}_frame\d+_\d{8}_\d{6}_\d{3}_\d{3}\.(\w{3})$/);
        if (!match) {
          return false;
        }
        device = match[1];
        type = match[2];
      }
      else { //find all
        parts = filename.split('~');
        if (parts.length < 1) {
          return false;
        }
        device = querystring.unescape(parts[0]);
      }
      if (devAry && devAry.indexOf(device) < 0 || typeAry && typeAry.indexOf(type) < 0) {
        return false;
      }
      getOrCreateDevCtx(device); //ensure having created device context
      return true;
    });

    if (findVideo) {
      //sort by time (newer first)
      filenameAry.sort(function (a, b) {
        a = a.replace(/\.\w+$/, '').slice(-nowStr.LEN);
        b = b.replace(/\.\w+$/, '').slice(-nowStr.LEN);
        return (a < b) ? 1 : (a > b) ? -1 : 0;
      });
    }
    else if (findImage) {
      //sort by time (newer first)
      filenameAry.sort(function (a, b) {
        a = a.slice(-nowStr.LEN - 4);
        b = b.slice(-nowStr.LEN - 4);
        return (a < b) ? 1 : (a > b) ? -1 : 0;
      });
    }

    return on_complete('', filenameAry);
  });
}

function deleteFiles(deviceOrAry/*optional*/, typeOrAry/*optional*/) {
  findFiles(deviceOrAry, typeOrAry, function /*on_complete*/(err, filenameAry) {
    if (err) {
      return;
    }
    filenameAry.forEach(function (filename) {
      try {
        fs.unlinkSync(conf.outputDir + '/' + filename);
      } catch (err) {
        log('failed to delete file "' + conf.outputDir + '/' + filename + '". ' + stringifyError(err));
      }
    });
    loadResourceSync();
  });
}

function updateCounter(device, type, delta, res/*ownerOutputStream*/) {
  var dev = devMgr[device], counter, counterType = res.filename ? 'recording' : res.newFilename ? 'converting' : 'streaming';

  //set overall counter. overallCounterMap[counterType].bytes will be set by write(res,...)
  if (!(counter = overallCounterMap[counterType])) {
    counter = overallCounterMap[counterType] = {count: 0, bytes: 0, startTimeMs: Date.now()};
    if (!status.timer) {
      status.timer = setInterval(pushStatus, 1000);
      status.timerRef = 1;
    } else {
      status.timerRef++;
    }
  }
  if ((counter.count += delta) <= 0) { //destroy counter if count is 0
    overallCounterMap[counterType] = null;
    if ((--status.timerRef) <= 0) {
      clearInterval(status.timer);
      status.timer = null;
    }
  }

  //set individual counter. res.counter.bytes will be set by write(res,...)
  if (!(res.counter = dev.counterMapRoot[type][counterType])) {
    res.counter = dev.counterMapRoot[type][counterType] = {count: 0, bytes: 0, startTimeMs: Date.now()};
  }
  if ((res.counter.count += delta) <= 0) { //destroy counter if count is 0
    res.counter = null;
    delete dev.counterMapRoot[type][counterType];
  }
  setTimeout(pushStatus, 0);

  startImageFileCleanerIfNecessary();
}

function pushStatus() {
  if (Object.keys(status.consumerMap).length === 0) {
    status.needRecalculation = true;
    return;
  }
  status.needRecalculation = false;

  var sd = {}, counter, disp, json;

  //set overall counter. overallCounterMap[counterType].bytes will be set by write(res,...)
  if ((counter = overallCounterMap.streaming)) {
    var bytesPerSec = (counter.bytes * 1000 / Math.max(1, Date.now() - counter.startTimeMs)).toFixed();
    sd.streamingSpeed = 'Network: ' + (bytesPerSec / 1000000).toFixed(3) + ' MB/s';
  } else {
    sd.streamingSpeed = '';
  }
  sd.totalRecordedFileSize = 'Storage: ' + (overallCounterMap.recorded.bytes / 1000000000).toFixed(3) + ' GB';
  sd.totalRecordingCount = overallCounterMap.recording ? overallCounterMap.recording.count : 0;
  sd.totalConvertingCount = overallCounterMap.converting ? overallCounterMap.converting.count : 0;

  //set individual counter. res.counter.bytes will be set by write(res,...)
  forEachValueIn(devMgr, function (dev, device) {
    forEachValueIn(dev.counterMapRoot, function (counterMap, type/*video/image type*/) {
      ['streaming', 'recording'].forEach(function (counterType) {
        counter = counterMap[counterType];
        disp = '';
        if (counter && counter.count) {
          if (counterType === 'streaming') {
            disp = 'Viewers:\n' + counter.count;
          } else {
            disp = 'Recording:\n' + (counter.bytes / 1000000).toFixed(3) + ' MB/' + getPeriodDisp(counter.startTimeMs);
          }
        }
        sd[counterType + 'Status_' + type + '_' + querystring.escape(device)] = disp;
      });
    });
  });

  if ((json = JSON.stringify(sd)) !== status.lastDataJson) {
    status.lastDataJson = json;
    status.ver = nowStr();
  }
  json = '{"appVer":"' + status.appVer + '", "ver":"' + status.ver + '","data":' + json + '}';

  forEachValueIn(status.consumerMap, function (res) {
    if (res.previousVer !== status.ver) {
      if (!status.timer || !res.previousVer ||
          Number(status.ver.slice(0, -4).replace(/_/g, '')) - Number(res.previousVer.slice(0, -4).replace(/_/g, '')) >= 1000) {
        end(res, json);
        delete status.consumerMap[res.consumerId];
      }
    }
  });

  function getPeriodDisp(startTimeMs) {
    var deltaSec = (Date.now() - startTimeMs) / 1000 % 86400;
    var h = (deltaSec / 3600).toFixed(), m = ((deltaSec %= 3600) / 60).toFixed(), s = (deltaSec % 60).toFixed();
    return (h ? (dpad2(h) + ':') : '') + dpad2(m) + ':' + dpad2(s);
  }
}

function pushStatusForAppVer() {
  var json = '{"appVer":"' + status.appVer + '"}';
  forEachValueIn(status.consumerMap, function (res) {
    end(res, json); //cause browser to refresh page
  });
  status.consumerMap = {};
}

var PNG_HEAD_HEX_STR = '89504e470d0a1a0a', APNG_STATE_READ_HEAD = 0, APNG_STATE_READ_DATA = 1, APNG_STATE_FIND_TAIL = 2;

function aimgCreateContext(device, type, id2) {
  var context = {};
  //public area
  context.frameIndex = 0;
  context.qdevice = querystring.escape(device);
  context.aimgDecoderIndex = type + 'Decoder' + nowStr();
  context.id = context.qdevice + '@' + context.aimgDecoderIndex;
  context.id2 = context.qdevice + '@' + id2; //user defined id, used as key of lastImageMap
  context.totalOffset = 0;

  //private area
  context.type = type;
  context.imageType = type.slice(1); //axxx -> xxx
  context.is_apng = type === 'apng';

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
          if (conf.logImageDecoderDetail) {
            log(context.id + '_frame' + context.frameIndex + ' chunkHead ' + context.tmpBuf.slice(4, 8) + ' ' + chunkDataSize);
          }
          if (chunkDataSize === 0 && context.tmpBuf.readInt32BE(4) === 0x49454E44) { //ok, found png tail
            if (!writeWholeImage()) {
              return;
            }
          } else {                                                          //not found tail
            if (chunkDataSize === 0) {
              log(context.id + '_frame' + context.frameIndex + ' ********************** chunkSize 0 *************************');
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
          if (conf.logImageDecoderDetail) {
            log(context.id + '_frame' + context.frameIndex + ' head ' + headHexStr);
          }
          if (headHexStr !== PNG_HEAD_HEX_STR) {
            log(context.id + '_frame' + context.frameIndex + ' ************************* wrong head*************************');
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
          if (conf.logImageDecoderDetail) {
            log(context.id + '_frame' + context.frameIndex + ' chunkData ' + context.scanedSize);
          }
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
      log(context.id + '_frame' + context.frameIndex + ' Warning: incomplete');
      writeWholeImage();
    } else {
      context.bufAry.push(buf.slice(unsavedStart, endPos));
    }
  }

  function writeWholeImage() {
    var myFrameComes = !context.fromFrame || context.frameIndex >= context.fromFrame;
    context.bufAry.push(buf.slice(unsavedStart, nextPos));
    unsavedStart = nextPos;

    var wholeImageBuf = Buffer.concat(context.bufAry);
    context.bufAry = [];

    var fileIndex = context.aimgDecoderIndex + '_frame' + context.frameIndex + '_' + nowStr() + '.' + context.imageType;
    var filename = context.qdevice + '@' + fileIndex;
    var setCookie = 'Set-Cookie: aimgDecoderIndex=' + context.aimgDecoderIndex;
    var isLastFrame = context.isLastBuffer && (nextPos === endPos);

    forEachValueIn(consumerMap, function (res) {
      if (myFrameComes) {
        if (res.setHeader && !res.__bytesWritten) {
          write(res, '--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/' + context.imageType + '\n' + setCookie + '\n\n');
        }

        write(res, wholeImageBuf);
      }

      if (isLastFrame) {
        end(res);
        delete lastImageMap[context.id];
        delete lastImageMap[context.id2];
      } else {
        if (myFrameComes) {
          if (res.setHeader) {
            //write next content-type early to force Chrome draw image immediately.
            write(res, '\n--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/' + context.imageType + '\n\n');
          }
        }
      }
    });

    if (myFrameComes) {
      lastImageMap[context.id] = {fileIndex: fileIndex, data: wholeImageBuf}; //save image in memory for later used by /saveImage command
      if (context.id2) {
        lastImageMap[context.id2] = lastImageMap[context.id];
      }
      if (conf.tempImageLifeMilliseconds) {
        if (conf.logImageDumpFile) {
          log('write "' + conf.outputDir + '/' + filename + '" length:' + wholeImageBuf.length + ' offset:', context.totalOffset);
        }
        try {
          fs.writeFileSync(conf.outputDir + '/' + filename, wholeImageBuf);
        } catch (err) {
          log('failed to write "' + conf.outputDir + '/' + filename + '". ' + stringifyError(err));
        }
      }
    }

    context.totalOffset += wholeImageBuf.length;
    wholeImageBuf = null;
    context.frameIndex++;
    if (context.is_apng) {
      context.state = APNG_STATE_READ_HEAD;
      context.requiredSize = 8; //head size
      context.scanedSize = 0;
    } else {
      context.isMark = false;
    }

    if (myFrameComes) {
      if (fnDecodeRest && !isLastFrame) {
        fnDecodeRest(nextPos);
        return false;
      }
    }
    return true;
  }
} //end of aimgDecode()

function startImageFileCleanerIfNecessary() {
  if (!conf.tempImageLifeMilliseconds) {
    return;
  }
  var needImageFileCleaner = 0;
  forEachValueIn(devMgr, function (dev) {
    Object.keys(aimgTypeSet).forEach(function (type) {
      needImageFileCleaner += Object.keys(dev.counterMapRoot[type]).length;
    });
  });
  if (needImageFileCleaner) {
    if (!imageFileCleanerTimer) {
      if (conf.logImageDumpFile) {
        log('[ImageFileCleaner]setTimer');
      }
      imageFileCleanerTimer = setTimeout(cleanOldImageFile, conf.tempImageLifeMilliseconds);
    }
  } else {
    if (imageFileCleanerTimer) {
      clearTimeout(imageFileCleanerTimer);
      imageFileCleanerTimer = null;
      if (conf.logImageDumpFile) {
        log('[ImageFileCleaner]clearTimer');
      }
    }
  }
}

function cleanOldImageFile() {
  var maxTimestamp = yyyymmdd_hhmmss_mmm(new Date(Date.now() - conf.tempImageLifeMilliseconds));
  fs.readdir(conf.outputDir, function (err, filenameAry) {
    if (err) {
      log('failed to readdir "' + conf.outputDir + '". ' + stringifyError(err));
    } else {
      filenameAry.forEach(function (filename) {
        var match = filename.match(/@\w{4}Decoder\d{8}_\d{6}_\d{3}_\d{3}_frame\d+_(\d{8}_\d{6}_\d{3})_\d{3}\.\w{3}$/);
        if (match) {
          if (match[1] < maxTimestamp) {
            if (conf.logImageDumpFile) {
              log('delete "' + conf.outputDir + '/' + filename + '"');
            }
            try {
              fs.unlinkSync(conf.outputDir + '/' + filename);
            } catch (err) {
              log('failed to delete "' + conf.outputDir + '/' + filename + '". ' + stringifyError(err));
            }
          }
        }
      });
    }

    startImageFileCleanerIfNecessary();
  });
}

function saveImage(res, device, aimgDecoderIndex) {
  var lastImage = lastImageMap[querystring.escape(device) + '@' + aimgDecoderIndex];
  if (!lastImage) {
    return end(res, 'error: image not found');
  }
  var fileIndex = lastImage.fileIndex;
  var filename = querystring.escape(device) + '~' + fileIndex;
  try {
    fs.writeFileSync(conf.outputDir + '/' + filename, lastImage.data);
  } catch (err) {
    log('failed to write "' + conf.outputDir + '/' + filename + '". ' + stringifyError(err));
    return end(res, 'file operation error ' + err.code);
  }
  return end(res, 'OK: ' + fileIndex);
}

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

function getByteRange(req) {
  var range = req.headers['range']; //just to avoid compiler warning
  if (!range) {
    return undefined;
  }
  var match = range.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) {
    return undefined;
  }
  return {start: match[1] ? Number(match[1]) : 0, end: match[2] ? (Number(match[2]) + 1) : undefined};
}

function startStreamWeb() {
  var httpServer, httpSeq = 0, _isAnyIp = isAnyIp(conf.ip), smark = (conf.ssl.on ? 's' : '');
  conf.ipForHtmlLink = (isAnyIp(conf.ip) ? '127.0.0.1' : conf.ip);
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
  httpServer.listen(conf.port, _isAnyIp ? undefined : conf.ip,
      function/*on_complete*/() {
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
    if (!process) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
      q = {device: '', accessKey: '', type: '', fps: 0, scale: 0, rotate: 0, recordOption: '', fileIndex: '', playerId: ''};
    }
    if (chkerrRequired('device', q.device)) {
      return res.end(chkerr);
    }
    var _accessKey = devMgr[q.device] ? devMgr[q.device].accessKey : '';
    if (_accessKey && _accessKey !== q.accessKey || !_accessKey && conf.adminWeb.adminKey) {
      res.statusCode = 403; //access denied
      return res.end('access denied');
    }

    switch (parsedUrl.pathname) {
      case '/common.css':
      case '/common.js':
        res.setHeader('Content-Type', parsedUrl.pathname.match(/\.[^.]*$/)[0] === '.css' ? 'text/css' : 'text/javascript');
        return res.end(htmlCache[parsedUrl.pathname.slice(1)]);
      default :
        res.logHead = '[HTTP' + smark.toUpperCase() + '_' + (res.seq = ++httpSeq) + ']';
        log(res.logHead.slice(0, -1) + (conf.logHttpReqAddr ? ' ' + req.connection.remoteAddress + ':' + req.connection.remotePort : '') + ' ' + req.url + ' ]' + 'begin' + (req.headers['range'] ? ' with range:' + req.headers['range'] : ''));
        res.on('close', function () { //closed without normal end(res,...)
          res.__isClosed = true;
          log(res.logHead + 'closed by peer');
        });
        res.on('finish', function () {
          if (!res.__isEnded) { //response stream have been flushed and ended without log
            log(res.logHead + 'finish');
          }
        });
    }

    setDefaultHttpHeader(res);

    switch (parsedUrl.pathname) {
      case '/capture': //---------------------------send capture result to browser & optionally save to file------------
        if (chkerrCaptureParameter(q) ||
            q.type === 'webm' && chkerrOptional('recordOption(optional)', q.recordOption, ['sync', 'async'])) {
          return end(res, chkerr);
        }
        if (q.type === 'webm' && q.recordOption) { //need record webm video at same time
          startRecording(q,
              function/*on_complete*/(err, wfile) {
                if (err) {
                  end(res, err);
                } else {
                  if (q.recordOption === 'sync') {
                    res.childConsumerId = wfile.consumerId; //remember the file so that end it with res together
                  } //else 'async'
                  capture(res, q); //also send capture result to browser
                }
              }
          );
        } else {
          capture(res, q); //only send to browser
        }
        break;
      case '/playRecordedFile': //---------------------------replay recorded file---------------------------------------
        if (chkerrRequired('type', q.type, Object.keys(videoTypeSet)) ||
            aimgTypeSet[q.type] && chkerrOptional('fps(optional)', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS)) {
          return end(res, chkerr);
        }
        playOrDownloadRecordedFile(res, q, false/*forPlay*/, getByteRange(req), false/*fileIndex not checked*/, false/*file not checked*/);
        break;
      case '/downloadRecordedFile': //---------------------download recorded file---------------------------------------
        if (chkerrRequired('type', q.type, Object.keys(videoTypeSet))) {
          return end(res, chkerr);
        }
        playOrDownloadRecordedFile(res, q, true/*forDownload*/, getByteRange(req), false/*fileIndex not checked*/, false/*file not checked*/);
        break;
      case '/liveViewer':  //------------------------------show live capture (Just as a sample) ------------------------
        if (chkerrCaptureParameter(q) ||
            q.type === 'webm' && chkerrOptional('recordOption(optional)', q.recordOption, ['sync', 'async'])) {
          return end(res, chkerr);
        }
        q.recordOption = q.recordOption || '';
        prepareDeviceFile(q.device, function /*on_complete*/(err) {
              if (err) {
                return end(res, err);
              }
              res.setHeader('Content-Type', 'text/html');
              return end(res, htmlCache[aimgTypeSet[q.type] ? 'aimg_liveViewer.html' : 'video_liveViewer.html'] //this html will in turn open URL /playRecordedFile?....
                  .replace(/@device\b/g, querystring.escape(q.device))
                  .replace(/#device\b/g, htmlEncode(q.device))
                  .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
                  .replace(/#accessKey\b/g, htmlEncode(q.accessKey || ''))
                  .replace(/@type\b/g, q.type)
                  .replace(/#realTypeDisp\b/g, htmlEncode(videoTypeNameMap[q.type]))
                  .replace(/@stream_web\b/g, 'http' + smark + '://' + req.headers.host)// http[s]://host:port
                  .replace(/@MIN_FPS\b/g, MIN_FPS)
                  .replace(/@MAX_FPS\b/g, MAX_FPS)
                  .replace(/@fps\b/g, q.fps)
                  .replace(/@scale\b/g, q.scale)
                  .replace(/@rotate\b/g, q.rotate)
                  .replace(new RegExp('name="rotate" value="' + q.rotate + '"', 'g'), '$& checked')  //set check mark
                  .replace(new RegExp('<option value="' + q.recordOption + '"', 'g'), '$& selected') //set selected
                  .replace(/@recordOption\b/g, q.recordOption)
              );
            }
        );
        break;
      case '/fileViewer':  //---------------------------show recorded file  (Just as a sample)--------------------------
        if (chkerrRequired('type', q.type, Object.keys(videoTypeSet)) ||
            aimgTypeSet[q.type] && chkerrOptional('fps(optional)', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS)) {
          return end(res, chkerr);
        }
        showFileViewer(false/*means file maybe need be converted to*/);
        break;
      case '/saveImage': //-----------------------save image from live view or recorded file ---------------------------
        var aimgDecoderIndex;
        if (req.headers.cookie && req.headers.cookie.indexOf('aimgDecoderIndex=') >= 0) {
          var match = req.headers.cookie.match(/aimgDecoderIndex=(\w{4}Decoder\d{8}_\d{6}_\d{3}_\d{3})\b/);
          if (!match) {
            return end(res, '`aimgDecoderIndex` cookie is not valid');
          }
          aimgDecoderIndex = match[1];
        } else if (q.playerId) {
          aimgDecoderIndex = querystring.escape(q.playerId);
        } else {
          if (devMgr[q.device] && devMgr[q.device].liveStreamer && devMgr[q.device].liveStreamer.aimgDecoder) {
            aimgDecoderIndex = devMgr[q.device].liveStreamer.aimgDecoder.aimgDecoderIndex;
          } else {
            var head = querystring.escape(q.device) + '@';
            if (!Object.keys(lastImageMap).some(function (id) {
              if (id.slice(0, head.length) === head) {
                aimgDecoderIndex = id.slice(head.length);
                return true;
              }
              return false;
            })) {
              log(res.logHead, '`aimgDecoderIndex` cookie and querystring is not specified and no any live capture nor animated image viewer is running');
              return end(res, 'error: image not found');
            }
          }
        }
        saveImage(res, q.device, aimgDecoderIndex);
        break;
      case '/showImage': //--------------------------show saved image --------------------------------------------------
        if (chkerrRequired('fileIndex', q.fileIndex)) {
          return end(res, chkerr);
        }
        match = q.fileIndex.match(/^\w{4}Decoder\d{8}_\d{6}_\d{3}_\d{3}_frame\d+_\d{8}_\d{6}_\d{3}_\d{3}\.(\w{3})$/);
        if (!match || !imageTypeSet[match[1]]) {
          return end(res, '`fileIndex` is not valid');
        }
        res.setHeader('Content-Type', 'image/' + match[1]);
        fs.createReadStream(conf.outputDir + '/' + querystring.escape(q.device) + '~' + q.fileIndex)
            .pipe(res)
            .on('error', function (err) {
              end(res, stringifyError(err));
            });
        break;
      case '/listSavedImages': //--------------------list all saved images----------------------------------------------
        var qdevice = querystring.escape(q.device);
        findFiles(q.device, Object.keys(imageTypeSet), function/*on_complete*/(err, filenameAry) {
          if (err || !filenameAry || !filenameAry.length) {
            return end(res, err || '');
          }
          var html = '<div style="width: 100%; text-align: center">';
          filenameAry.forEach(function (filename) {
            var fileIndex = filename.slice(qdevice.length + 1);
            html += '<img src=' + '"/' + 'showImage?device=' + querystring.escape(q.device) + '&accessKey=' + querystring.escape(q.accessKey) + '&fileIndex=' + fileIndex + '"/>';
          });
          html += '</div>';
          res.setHeader('Content-Type', 'text/html');
          return end(res, html);
        });
        break;
      default:
        end(res, 'bad request');
    }
    return ''; //just to avoid compiler warning

    function showFileViewer(__file_converted) {
      findFiles(q.device, q.type, function/*on_complete*/(err, filenameAry) {
        var filename, absFileIndex, relFileIndex;
        if ((relFileIndex = Number(q.fileIndex || 0)) >= 0) {
          if (err || !(filename = filenameAry[relFileIndex])) {
            return end(res, err || 'error: file not found');
          }
          absFileIndex = filename.slice(querystring.escape(q.device).length + 1 + q.type.length + 1); //strip SN~type~
        } else {
          absFileIndex = q.fileIndex;
          filename = querystring.escape(q.device) + '~' + q.type + '~' + absFileIndex;
          relFileIndex = filenameAry.indexOf(filename);
        }

        var origFps = absFileIndex.match(/^f([0-9.]+)/);
        if (!origFps || chkerrRequired('fps', (origFps = Number(origFps[1])), MIN_FPS, MAX_FPS)) {
          return end(res, 'bad `fileIndex`');
        }
        q.fps = q.fps || origFps;

        var realType = absFileIndex.match(/\.(\w+)$/); //get extension name
        realType = realType ? realType[1] : q.type;

        var origFilename = filename.replace(/\.(\w+)$/, ''); //remove extension name

        if (relFileIndex < 0) {
          if (realType === q.type || __file_converted) {
            return end(res, 'error: file not found');
          }
          if (filenameAry.indexOf(origFilename) < 0) {
            return end(res, 'error: file not found');
          }
          /*
           * ------------- convert file format if not exists-----------------
           */
          var waiter = convertRecordedFile(origFilename, filename, q.type, origFps, realType, function/*on_complete*/(err) {
            if (err) {
              end(res, err);
            } else { //-------------------------when conversion succeed, do showFileViewer-----------------------
              showFileViewer(true/*__file_converted*/);
            }
          });
          if (waiter) {
            res.on('close', function () { //http connection is closed without normal end(res,...)
              endConverterWaiter(waiter, 'owner http connection is closed by peer');
            });
          }
          return '';
        }

        var origFileIndex = absFileIndex.replace(/\.(\w+)$/, ''); //remove extension name

        res.setHeader('Content-Type', 'text/html');
        return end(res, htmlCache[aimgTypeSet[realType] ? 'aimg_fileViewer.html' : 'video_fileViewer.html'] //this html will in turn open URL /playRecordedFile?....
            .replace(/@device\b/g, querystring.escape(q.device))
            .replace(/#device\b/g, htmlEncode(q.device))
            .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
            .replace(/#accessKey\b/g, htmlEncode(q.accessKey || ''))
            .replace(/@type\b/g, q.type) //owner type
            .replace(/@realType\b/g, realType)
            .replace(/#realTypeDisp\b/g, htmlEncode(videoTypeNameMap[realType] || (realType.slice(0, 1).toUpperCase() + realType.slice(1) + ' Video')))
            .replace(/@stream_web\b/g, 'http' + smark + '://' + req.headers.host)// http[s]://host:port
            .replace(/@relFileIndex\b/g, relFileIndex)
            .replace(/@absFileIndex\b/g, absFileIndex)
            .replace(/@maxRelFileIndex\b/g, filenameAry.length - 1)
            .replace(/@olderFileIndex\b/g, Math.min(relFileIndex + 1, filenameAry.length - 1))
            .replace(/@newerFileIndex\b/g, Math.max(relFileIndex - 1, 0))
            .replace(/@pathname\b/g, parsedUrl.pathname)
            .replace(/@MIN_FPS\b/g, MIN_FPS)
            .replace(/@MAX_FPS\b/g, MAX_FPS)
            .replace(/@fps\b/g, q.fps)
            .replace(/&fromFrame=@fromFrame\b/g, Number(q.fromFrame) > 0 ? '&fromFrame=' + q.fromFrame : '') //debug only
            .replace(/@playerId\b/g, nowStr())
            .replace(new RegExp('hideIf_' + realType, 'g'), 'style="display:none"')
            .replace(new RegExp('hideIf_' + q.type, 'g'), 'style="display:none"')
            .replace(/@origFileIndex\b/g, origFileIndex)
        );
      });
    } //end of showFileViewer()
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
  httpServer.listen(conf.adminWeb.port, _isAnyIp ? undefined : conf.adminWeb.ip,
      function/*on_complete*/() {
        log(httpServer.logHead + 'OK. You can start from http' + smark + '://' + (_isAnyIp ? '127.0.0.1' : conf.adminWeb.ip) + ':' + conf.adminWeb.port + '/?adminKey=' + querystring.escape(conf.adminWeb.adminKey), {stderr: true});
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
    if (!process) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
      q = {adminKey: '', device: [], accessKey: '', type: '', fps: 0, scale: 0, rotate: 0, action: '', logDate: '', logDownload: '', logStart: '', logEnd: '', tempImageLifeMilliseconds: ''};
    }
    if (conf.adminWeb.adminKey && q.adminKey !== conf.adminWeb.adminKey) {
      res.statusCode = 403; //access denied
      return res.end('access denied');
    }

    switch (parsedUrl.pathname) {
      case '/common.css':
      case '/common.js':
      case '/jquery-2.0.3.js':
        res.setHeader('Content-Type', parsedUrl.pathname.match(/\.[^.]*$/)[0] === '.css' ? 'text/css' : 'text/javascript');
        return res.end(htmlCache[parsedUrl.pathname.slice(1)]);
      case '/status':
      case '/getLog':
        break;
      default :
        res.logHead = '[AdminHTTP' + smark.toUpperCase() + '_' + (res.seq = ++httpSeq) + ']';
        log(res.logHead.slice(0, -1) + ' ' + req.url + ' ]' + 'begin');

        res.on('close', function () { //closed without normal end(res,...)
          res.__isClosed = true;
          log(res.logHead + 'closed by peer');
        });
        res.on('finish', function () {
          if (!res.__isEnded) { //response stream have been flushed and ended without log
            log(res.logHead + 'finish');
          }
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
            status.appVer = nowStr();
            setTimeout(pushStatusForAppVer, 50);
            if (req.headers.referer) {
              res.writeHead(302, {Location: req.headers.referer});
            }
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
              startRecording(_q,
                  function/*on_complete*/(err, wfile) {
                    if (err) {
                      errAry.push(devAry.length > 1 ? device + ': ' + err : err);
                    } else {
                      var fileIndex = wfile.filename.slice(querystring.escape(_q.device).length + 1 + _q.type.length + 1); //strip SN~type~
                      okAry.push((devAry.length > 1 ? device + ' OK: ' : 'OK: ') + fileIndex);
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
            if (chkerrRequired('type', q.type, Object.keys(videoTypeSet))) {
              return end(res, chkerr);
            }
            deleteFiles(q.device, q.type);
            end(res, 'OK');
            break;
          case 'deleteImages': //--------------------------delete image files for multiple devices----------------------
            deleteFiles(q.device, Object.keys(imageTypeSet));
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
        spawn('[GetDeviceLog]', conf.adb, ['-s', q.device, 'shell', 'cat', ANDROID_WORK_DIR + '/log'],
            function  /*on_close*/(ret, stdout, stderr) {
              end(res, removeNullChar(stdout) || toErrSentence(stderr) || (ret !== 0 ? 'unknown error' : ''));
            }, {noLogStdout: true});
        break;
      case '/getDeviceCpuMemTop':  //--------------------------get device cpu memory usage -----------------------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        prepareDeviceFile(q.device, function /*on_complete*/(err) {
              if (err) {
                return end(res, err);
              }
              return spawn('[GetDeviceCpuMemTop]', conf.adb, ['-s', q.device, 'shell', ANDROID_WORK_DIR + '/busybox', 'top', '-b', '-n' , '1'],
                  function  /*on_close*/(ret, stdout, stderr) {
                    end(res, removeNullChar(stdout) || toErrSentence(stderr) || (ret !== 0 ? 'unknown error' : ''));
                  }, {noLogStdout: true});
            }
        );
        break;
      case '/downloadRawScreenshot':  //----------------------------download android screen raw screenshot--------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        prepareDeviceFile(q.device, function /*on_complete*/(err) {
              if (err) {
                end(res, err);
                return;
              }
              res.setHeader('Content-Type', 'image/raw');
              res.setHeader('Content-Disposition', 'attachment;filename=' + querystring.escape(q.device) + '~raw~' + nowStr());

              var childProc = spawn('[RawCapture]', conf.adb, ['-s', q.device, 'shell', 'cd', ANDROID_WORK_DIR, ';',
                'sh', ANDROID_WORK_DIR + '/capture_raw.sh',
                (conf.remoteLogAppend ? '2>>' : '2>'), ANDROID_WORK_DIR + '/log']);

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
                end(res, childProc.__spawnErr);
              });
              childProc.on('close', function () {
                end(res);
              });
            }
        );
        break;
      case '/': //---------------------------------------show menu of all devices---------------------------------------
        q.fps = q.fps || 4;
        q.type = q.type || 'ajpg';
        q.scale = (q.scale === undefined) ? '300x' : q.scale;
        if (chkerrCaptureParameter(q)) {
          return end(res, chkerr);
        }
        getAllDevInfo(
            function /*on_complete*/(err, deviceList, infoList) {
              (deviceList || []).forEach(function (device, i) {
                getOrCreateDevCtx(device).info = infoList[i]; //save serial number and info to devMgr
              });

              var html = htmlCache['menu.html']
                      .replace(/@adminKey\b/g, querystring.escape(conf.adminWeb.adminKey))
                      .replace(/#adminKey\b/g, htmlEncode(conf.adminWeb.adminKey || ''))
                      .replace(/@MIN_FPS\b/g, String(MIN_FPS))
                      .replace(/@MAX_FPS\b/g, String(MAX_FPS))
                      .replace(/@fps\b/g, q.fps)
                      .replace(/@scale\b/g, q.scale)
                      .replace(/@rotate\b/g, q.rotate)
                      .replace(new RegExp('name="rotate" value="' + q.rotate + '"', 'g'), '$& checked')  //set check mark
                      .replace(new RegExp('name="type" value="' + q.type + '"', 'g'), '$& checked')  //set check mark
                      .replace(/@stream_web\b/g, 'http' + (conf.ssl.on ? 's' : '') + '://' + conf.ipForHtmlLink + ':' + conf.port)
                      .replace(/@totalRecordedFileSize_disp\b/g, 'Storage: ' + (overallCounterMap.recorded.bytes / 1000000000).toFixed(3) + ' GB')
                      .replace(/@streamWebIP\b/g, conf.ipForHtmlLink)
                      .replace(/@logStart\b/g, conf.logStart || -1000)
                      .replace(/@logEnd\b/g, conf.logEnd || '')
                      .replace(/@appVer\b/g, status.appVer)
                      .replace(/@tempImageLifeMilliseconds\b/g, conf.tempImageLifeMilliseconds)
                  ;
              //set enable or disable of some config buttons for /var? command
              dynamicConfKeyList.forEach(function (k) {
                html = html.replace('@' + k + '_negVal', (conf[k] ? 'false' : 'true')).replace('#' + k + '_negBtn', (conf[k] ? 'Disable' : 'Enable'));
              });

              res.setHeader('Content-Type', 'text/html');
              end(res, html.replace(/<!--repeatBegin-->[^\0]*<!--repeatEnd-->/, createMultipleHtmlRows));

              function createMultipleHtmlRows(htmlRow) {
                return Object.keys(devMgr).sort().reduce(function (joinedStr, device) {
                  var dev = devMgr[device];
                  return joinedStr + htmlRow //do some device concerned replace
                      .replace(/#devinfo\b/g, htmlEncode(dev.info || 'Unknown'))
                      .replace(/#devinfo_class\b/g, (dev.info ? '' : 'errorWithTip') + (deviceList.indexOf(device) >= 0 ? '' : ' disconnected'))
                      .replace(/#device\b/g, htmlEncode(device))
                      .replace(/@device\b/g, querystring.escape(device))
                      .replace(/#accessKey\b/g, htmlEncode(dev.accessKey || ''))
                      .replace(/@accessKey\b/g, querystring.escape(dev.accessKey || ''))
                      .replace(/#accessKey_disp\b/g, htmlEncode(dev.accessKey ? dev.accessKey : conf.adminWeb.adminKey ? '<None> Please "Set Access Key" for this device' : '<None>'))
                      .replace(/#styleName_AccessKey_disp\b/g, (dev.accessKey || !conf.adminWeb.adminKey) ? '' : 'errorWithTip')
                      ;
                }, ''/*initial joinedStr*/);
              }
            });
        break;
      case '/stopServer':  //------------------------------------stop server management---------------------------------
        end(res, 'OK');
        log('stop on demand');
        httpServer.close();
        process.streamWeb.close();
        forEachValueIn(devMgr, function (dev) {
          forEachValueIn(dev.liveStreamer.consumerMap, endCaptureConsumer, res, 'stop server');
        });
        Object.keys(childProcPidMap).forEach(function (pid) {
          log('kill child process pid_' + pid);
          try {
            process.kill(pid);
          } catch (err) {
            if (err.code !== 'ENOENT') {
              log('failed to kill process pid_' + pid + '. ' + stringifyError(err));
            }
          }
        });
        setInterval(function () {
          if (Object.keys(recordingFileMap).length) {
            log('there are ' + Object.keys(recordingFileMap).length + ' recording files have not been flushed. Wait...');
            process.toBeExited = true; //let 'close' event handler of recording file to do the check
          } else {
            log('no problem. Now exit');
            process.exit(0);
          }
        }, 100);
        break;
      case '/restartAdb':  //------------------------------------restart ADB--------------------------------------------
        log(httpServer.logHead + 'restart ADB');
        spawn('[StopAdb]', conf.adb, ['kill-server'],
            function  /*on_close*/(/*ret, stdout, stderr*/) {
              spawn('[StartAdb]', conf.adb, ['start-server'],
                  function  /*on_close*/(/*ret, stdout, stderr*/) {
                    end(res, 'OK');
                  });
            });
        break;
      case '/reloadResource':  //-----------------------------reload resource file to cache-----------------------------
        loadResourceSync();
        if (req.headers.referer) {
          req.headers.referer = req.headers.referer || '/'; //just to avoid compiler warning
          res.writeHead(302, {Location: req.headers.referer});
        }
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
          status.appVer = nowStr();
          setTimeout(pushStatusForAppVer, 50);
        }
        if (req.headers.referer) {
          res.writeHead(302, {Location: req.headers.referer});
        }
        end(res, 'OK');
        break;
      case '/useStreamWebIp':
        if (chkerrRequired('ip', q.ip)) {
          return end(res, chkerr);
        }
        if (conf.ipForHtmlLink !== q.ip) {
          conf.ipForHtmlLink = isAnyIp(q.ip) ? '127.0.0.1' : q.ip;
          status.appVer = nowStr();
          setTimeout(pushStatusForAppVer, 50);
        }
        if (req.headers.referer) {
          res.writeHead(302, {Location: req.headers.referer});
        }
        end(res, 'OK');
        break;
      case '/setTempImageFileLife' :
        if (chkerrRequired('tempImageLifeMilliseconds', (q.tempImageLifeMilliseconds = Number(q.tempImageLifeMilliseconds)), 0, 24 * 60 * 60 * 1000)) {
          return end(res, chkerr);
        }
        if (conf.tempImageLifeMilliseconds !== q.tempImageLifeMilliseconds) {
          conf.tempImageLifeMilliseconds = q.tempImageLifeMilliseconds;
          if (imageFileCleanerTimer) {
            clearTimeout(imageFileCleanerTimer);
            imageFileCleanerTimer = null;
            if (conf.logImageDumpFile) {
              log('[ImageFileCleaner]clearTimer');
            }
          }
          startImageFileCleanerIfNecessary();

          status.appVer = nowStr();
          setTimeout(pushStatusForAppVer, 50);
        }
        if (req.headers.referer) {
          res.writeHead(302, {Location: req.headers.referer});
        }
        end(res, 'OK');
        break;
      case '/status':  //-----------------------------------push javascript to browser----------------------------------
        res.setHeader('Content-Type', 'text/json');
        res.previousVer = q.ver;
        status.consumerMap[(res.consumerId = nowStr())] = res;
        pushStatus();
        res.on('close', function () { //closed without normal end(res,...)
          delete status.consumerMap[res.consumerId];
        });
        break;
      case '/getLog':  //----------------------------------------get log------------------------------------------------
        var logFilePath = q.logDate === 'today' ? log.context.todayLogFilePath : log.context.yesterdayLogFilePath;
        var size;
        try {
          size = fs.statSync(logFilePath).size;
        } catch (err) {
          return end(res, stringifyError(err));
        }
        var haveLogStart = q.logStart !== undefined;
        var haveLogEnd = q.logEnd !== undefined;
        q.logStart = Number(q.logStart) || 0;
        q.logEnd = Number(q.logEnd) || size;
        if (q.logStart < 0 && (q.logStart += size) < 0) {
          q.logStart = 0;
        }
        if (q.logEnd < 0 && (q.logEnd += size) < 0) {
          q.logEnd = 0;
        }
        if (q.logEnd < q.logStart) {
          var tmp = q.logEnd;
          q.logEnd = q.logStart;
          q.logStart = tmp;
        }
        if (q.logStart > size) {
          return end(res);
        }
        if (q.logEnd > size) {
          q.logEnd = size;
        }
        if ((size = q.logEnd - q.logStart) === 0) {
          return end(res);
        }

        if (haveLogStart) {
          conf.logStart = q.logStart;
        }
        if (haveLogEnd) {
          conf.logEnd = q.logEnd;
        }

        if (q.logDownload === 'true') {
          res.setHeader('Content-Disposition', 'attachment;filename=asc~' + require('path').basename(logFilePath)); //did contains extension name
        }
        res.setHeader('Content-Length', size);

        fs.createReadStream(logFilePath, {start: q.logStart, end: q.logEnd})
            .pipe(res)
            .on('error', function (err) {
              end(res, stringifyError(err));
            });
        break;
      case '/prepareDeviceFile':  //--------------------------prepare device file forcibly -----------------------------
        if (Object.keys(devMgr).length === 0) {
          if (req.headers.referer) {
            res.writeHead(302, {Location: req.headers.referer});
          }
          end(res, 'OK');
        }
        okAry = [];
        errAry = [];
        prepareDeviceFile.ver = getLocalToolFileHashSync();
        Object.keys(devMgr).forEach(function (device, i, devAry) {
          devMgr[device].didPrepare = false;
          prepareDeviceFile(device, function /*on_complete*/(err) {
                if (err) {
                  errAry.push(devAry.length > 1 ? device + ': ' + err : err);
                } else {
                  okAry.push(devAry.length > 1 ? device + ' OK: ' : 'OK: ');
                }
                if (errAry.length + okAry.length === devAry.length) { //loop completed, now write response
                  if (okAry.length) {
                    status.appVer = nowStr();
                    setTimeout(pushStatusForAppVer, 50);
                  }
                  if (req.headers.referer) {
                    res.writeHead(302, {Location: req.headers.referer});
                  }
                  end(res, okAry.concat(errAry).join('\n'));
                }
              }
          );
        });
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

  overallCounterMap.recorded.bytes = 0;
  //scan recorded files to get device serial numbers ever used
  var filenameAry;
  try {
    filenameAry = fs.readdirSync(conf.outputDir);
  } catch (err) {
    log('failed to check output dir "' + conf.outputDir + '"' + stringifyError(err), {stderr: true});
    process.exit(1);
    return;
  }
  filenameAry.forEach(function (filename) {
    var parts = filename.split('~');
    if (parts.length > 1) {
      getOrCreateDevCtx(querystring.unescape(parts[0])/*device serial number*/);
      var stats;
      try {
        stats = fs.statSync(conf.outputDir + '/' + filename);
      } catch (err) {
        return;
      }
      overallCounterMap.recorded.bytes += stats.size;
    }
  });

  status.appVer = nowStr();
  pushStatusForAppVer();
}

loadResourceSync();

checkAdb(function/*on_complete*/() {
  checkFfmpeg(function/*on_complete*/() {
    imageFileCleanerTimer = setTimeout(cleanOldImageFile, conf.tempImageLifeMilliseconds);
    startAdminWeb();
    startStreamWeb();
  });
});

//todo: firefox can not play mp4 but chrome can
//todo: some device crashes if live view full image
//todo: sometimes ScreenshotClient::update just failed
//todo: screenshot buffer changed frequently, should lock
//todo: should use busybox to compute file hash
//todo: close existing ffmpeg processes in android by busybox -> seems adb ignore SIGPIPE so sometimes it does not exit if parent node.js exit
//todo: create shell script to start this application, download ffmpeg bin
//todo: use "for ever" tool to start this server
//todo: safari: multipart/x-mixed-replace still does not work
//todo: adapt fps change without interrupting viewer
//todo: use error image or video to show error
//todo: water mark
//todo: add audio
//todo: make touchable: forward motion event to android
//todo: remove dependence of adb
