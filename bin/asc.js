//'use strict';
var old_work_dir = process.cwd();
process.chdir(__dirname); //set dir of current file as working dir
var child_process = require('child_process'), fs = require('fs'), os = require('os'), Url = require('url'), querystring = require('querystring'), Path = require('path'), crypto = require('crypto'), util = require('util'),
    jsonFile = require('./node_modules/jsonFile.js'), logger = require('./node_modules/logger.js'),
    cfg = util._extend(jsonFile.parse('./config.json'), process.argv[2/*first param*/] && jsonFile.parse(Path.resolve(old_work_dir, process.argv[2]))), //combine user provided configuration file with base file
    log = logger.create(cfg && cfg.log_filePath, cfg && cfg.log_keepOldFileDays);
log('===================================pid:' + process.pid + '=======================================\nuse configuration: ' + JSON.stringify(cfg, null, '  '));
process.on('uncaughtException', function (err) {
  log('uncaughtException: ' + err + "\n" + err.stack, {stderr: true});
  throw err;
});
var devMgr = {/*deviceSN:*/}, status = { consumerMap: {/*consumerId:*/}}, htmlCache = {/*'/'+filename:*/}, childProcMap = {/*pid:*/},
    adminWeb, streamWeb, ffmpegOK, httpSeq = 0;
var MULTIPART_INNER_HEAD = new Buffer('--MULTIPART_BOUNDARY\r\nContent-Type: image/jpeg\r\n\r\n'), MULTIPART_CRLF_INNER_HEAD = new Buffer('\r\n' + MULTIPART_INNER_HEAD);
var ERR_DEV_NOT_FOUND = 'error: device not found', REC_TAG = '[REC]', CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = new Buffer([CR]), EMPTY_BUF = new Buffer([]);
var re_filename = /^(([^\/\\]+)~(?:live|rec)_f\d+(?:\.\d+)?[^_]*_(\d{14}\.\d{3}(?:\.[A-Z]?\d+)?)\.ajpg)(?:(?:\.(webm|mp4))|(?:~frame[A-Z]?\d+\.(jpg)))$/,
    re_httpRange = /^bytes=(\d*)-(\d*)$/i, re_adminKey_cookie = /adminKey=([^;]+)/, re_repeatableHtmlBlock = /<!--repeatBegin-->\s*([^\0]*)\s*<!--repeatEnd-->/g;
var dynamicConfKeyList = ['showDisconnectedDevices', 'logFfmpegDebugInfo', 'logFpsStatistic', 'logHttpReqDetail', 'logAllAdbCommands', 'logAllHttpRequests'];
true === false && log({log_filePath: 0, log_keepOldFileDays: 0, adb: 0, adbOption: 0, ffmpeg: 0, androidWorkDir: 0, androidLogPath: 0, streamWeb_ip: 0, streamWeb_port: 0, streamWeb_protocol: 0, adminWeb_ip: 0, adminWeb_port: 0, adminWeb_protocol: 0, outputDir: 0, enableGetOutputFile: 0, maxRecordTime: 0, range: 0, orientation: 0, action: 0, logHowManyDaysAgo: 0, download: 0, adbGetDeviceListTimeout: 0, adbDeviceListUpdateInterval: 0, adbKeepDeviceAliveInterval: 0, err: 0, x: 0, y: 0, stack: 0, logFfmpegDebugInfo: 0, logFpsStatistic: 0, logHttpReqDetail: 0, showDisconnectedDevices: 0, alsoRecordAsWebM: 0, logAllAdbCommands: 0, adbEchoTimeout: 0, adbFinishPrepareFileTimeout: 0, adbPushFileToDeviceTimeout: 0, adbCheckDeviceTimeout: 0, adbCaptureExitDelayTime: 0, adbSendKeyTimeout: 0, adbSetOrientationTimeout: 0, defaultScale: 0, defaultFps: 0, minFps: 0, maxFps: 0, adbTurnScreenOnTimeout: 0, fpsStatisticInterval: 0, logAllHttpRequests: 0, discover_from_ip_part4: 0, discover_to_ip_part4: 0, discover_port: 0, discover_maxFound: 0, discover_timeout: 0, discover_totalTimeout: 0, touch: {}});

function spawn(tag, _path, args, _on_close, _opt) {
  var on_close = (typeof(_on_close) === 'function') && _on_close, opt = !on_close && _on_close || _opt || {}, childProc, stdoutBufAry = [], stderrBufAry = [], logHead1, logHead2;
  opt.stdio = opt.stdio || ['ignore'/*stdin*/, 'pipe'/*stdout*/, 'pipe'/*stderr*/];
  !opt.noDetailLog && log(tag + ' spawn \"' + _path + '\" with args: ' + JSON.stringify(args));

  childProc = child_process.spawn(_path, args, opt);
  childProc.__tag = tag = tag + (childProc.pid ? '[pid_' + childProc.pid + ']' : '');
  !opt.noDetailLog && log(tag + (childProc.pid ? ' spawned' : ' not spawned'));
  childProc.pid && (childProcMap[childProc.pid] = childProc);

  childProc.stdout && (on_close || !opt.noDetailLog && !opt.noLogStdout) && childProc.stdout.on('data', function (buf) {
    on_close && stdoutBufAry.push(buf);
    !opt.noDetailLog && !opt.noLogStdout && log(buf, {noNewLine: true, head: (logHead1 = logHead1 || tag + '>')});
  });
  childProc.stderr && childProc.stderr.on('data', function (buf) {
    on_close && stderrBufAry.push(buf);
    log(buf, {noNewLine: true, head: (logHead2 = logHead2 || tag + '2>')});
  });
  opt.timeout && (childProc.__timeoutTimer = setTimeout(function () {
    childProc.__err = 'error: timeout';
    !opt.noDetailLog && log(tag + ' kill due to timeout(' + opt.timeout + 's)');
    childProc.kill('SIGKILL');
  }, opt.timeout));

  childProc.on('error', function (err) {
    !opt.noDetailLog && log(tag + ' ' + (childProc.__err = stringifyError(err)));
  });
  childProc.on('close', function (ret, signal) { //exited or failed to spawn
    !opt.noDetailLog && log(tag + ' exited:' + (ret === null || ret === undefined ? '' : (' ' + ret)) + (signal ? (' ' + (signal || '')) : ''));
    delete childProcMap[childProc.pid];
    clearTimeout(childProc.__timeoutTimer);
    !childProc.__err && signal && (childProc.__err = 'error: killed by ' + signal);
    if (on_close) {
      var stderr = childProc.__err || Buffer.concat(stderrBufAry).toString(), stdout = Buffer.concat(stdoutBufAry).toString();
      stdoutBufAry.length = stderrBufAry.length = 0;
      on_close(ret, stdout, stderr);
    }
  });
  childProc.stdin && childProc.stdin.on('error', function (err) {
    !opt.noDetailLog && log(tag + '[stdin] ' + stringifyError(err));
  });
  return childProc;
}

function stringifyError(err) {
  return !err ? '' : err.code === 'ENOENT' ? 'error: ENOENT(not found)' : err.code === 'EACCES' ? 'error: EACCES(access denied)' : err.code === 'EADDRINUSE' ? 'error: EADDRINUSE(IP or port already in use)'
      : (!(err = err.toString().trim().split(/\r*\n/)[0].trim()) ? '' : /error/i.test(err) ? err : 'error: ' + err);
}

function htmlEncode(text) {
  return text.replace(/[^0-9a-zA-Z]/g, function (match) {
    return match === '&' ? '&amp;' : match === '<' ? '&lt;' : match === '>' ? '&gt;' : match === '"' ? '&quot;' : ('&#' + match.charCodeAt(0) + ';');
  });
}
function htmlIdEncode(text) {
  return text.replace(/[^0-9a-zA-Z]/g, function (match) {
    return ('_' + match.charCodeAt(0).toString(16) + '_');
  });
}

function forEachValueIn(mapOrArray, callback, extraParameterForCallback/*optional*/) {
  var _argLen = arguments.length;
  return Object.keys(mapOrArray).some(function (k) {
    return (_argLen === 2 ? callback(mapOrArray[k], k, mapOrArray) : callback(mapOrArray[k], extraParameterForCallback, k, mapOrArray)) === 'break';
  });
}

function pad234(d, len/*2~4*/) {
  return len === 2 ? ((d < 10) ? '0' + d : d.toString()) : len === 3 ? ((d < 10) ? '00' + d : (d < 100) ? '0' + d : d.toString()) : len === 4 ? ((d < 10) ? '000' + d : (d < 100) ? '00' + d : (d < 1000) ? '0' + d : d.toString()) : d;
}
function getTimestamp() {
  var dt = new Date(), seqStr = '';
  if (dt.valueOf() === getTimestamp.dtMs) {
    seqStr = '.' + String.fromCharCode(65 + (seqStr = String(++getTimestamp.seq)).length - 1) + seqStr; //make sortable number. 9->A9 10->B10 so B10 > A9
  } else {
    getTimestamp.seq = 0;
    getTimestamp.dtMs = dt.valueOf();
  }
  return pad234(dt.getFullYear(), 4) + pad234(dt.getMonth() + 1, 2) + pad234(dt.getDate(), 2) + pad234(dt.getHours(), 2) + pad234(dt.getMinutes(), 2) + pad234(dt.getSeconds(), 2) + '.' + pad234(dt.getMilliseconds(), 3) + seqStr;
}
function stringifyTimestampShort(ts) {
  return ts.slice(4, 6) + '/' + ts.slice(6, 8) + ' ' + ts.slice(8, 10) + ':' + ts.slice(10, 12) + ':' + ts.slice(12, 14);
}

function chk(name, value /*, next parameters: candidateArray | candidateValue | candidateMinValue, candidateMaxValue*/) {
  if (arguments.length === 3) { //check against array
    if (value === undefined || (Array.isArray(arguments[2]) ? arguments[2] : [arguments[2]]).indexOf(value) < 0) {
      return !(chk.err = '`' + name + '`' + ': must be in ' + JSON.stringify(arguments[2]));
    }
  } else if (arguments.length === 4) { //check against range
    if (value === undefined || !(value >= arguments[2] && value <= arguments[3])) { //do not use v < min || v > max due to NaN always cause false
      return !(chk.err = '`' + name + '`' + ': must be in (' + arguments[2] + ' ~ ' + arguments[3] + ')');
    }
  } else if (!value) { //check required only
    return !(chk.err = '`' + name + '`' + ': must be specified');
  } else if (Array.isArray(value)) {
    return !(chk.err = '`' + name + '`' + ': must be a single value');
  }
  return true;
}

function write(res, buf) {
  return !res.__isEnded && !res.__isClosed && (res.__bytesWritten = (res.__bytesWritten || 0) + buf.length) && res.write(buf);
}
function end(res, textContent/*optional*/, type) {
  if (!res.__isEnded && !res.__isClosed) {
    res.__isEnded = true;
    if (textContent && res.setHeader && !res.headersSent) { //for unsent http response
      res.setHeader('Content-Type', type || 'text/plain');
      !type && res.removeHeader('Content-Length');
      !type && res.removeHeader('Content-Disposition'); //remove download flag
    }
    res.__logReq && log(res.__tag + ' END. ' + (textContent ? (type ? '' : textContent) : ((res.__bytesWritten || 0) + ' bytes written')));
    res.end(textContent);
  }
}

function isAnyIp(ip) {
  return ip === '*' || ip === '0.0.0.0' || ip === '::' || ip === '' || ip === undefined;
}
function isLocalOnlyIP(ip) {
  return ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '0:0:0:0:0:0:0:1';
}
function getFirstPublicIp() {
  var ip = '', niMap = os.networkInterfaces();
  return Object.keys(niMap).some(function (name) {
    return niMap[name].some(function (addr) {
      return !addr['internal'] && addr['family'] === 'IPv4' && (ip = addr.address);
    });
  }) ? ip : '';
}

function getFileSizeSync(filePath) {
  try {
    chk.err = '';
    return fs.statSync(filePath).size;
  } catch (err) {
    chk.err = stringifyError(err);
    return 0;
  }
}

function FilenameInfo(filename, device) {
  ((filename = filename && filename.match(re_filename)) && (this.device = querystring.unescape(filename[2])) && (!device || this.device === device))
      && (this.origFilename = filename[1]) && (this.origTimestamp = filename[3]) && (this.type = filename[4] || filename[5]) && (this.isValid = filename[0]);
}
FilenameInfo.prototype.toString = function () {
  return this.isValid;
};

function convertCRLFToLF(context, requiredCrCount, buf) {
  if (!requiredCrCount) { //lucky! no CR prepended, so need not convert.
    return [buf];
  }
  var bufAry = [], startPos = 0, crCount = 0, bufLen = buf.length;
  if (context.orphanCrCount) { //remove orphan CR
    var restCrCount = requiredCrCount - context.orphanCrCount;
    (!restCrCount && buf[0] === LF || restCrCount && buf[0] === CR && buf[1] === LF)
        ? (startPos = restCrCount)
        : bufAry.push(context.orphanCrCount === 2 ? BUF_CR2 : BUF_CR);
    context.orphanCrCount = 0;
  }
  for (var i = startPos; i < bufLen; i++) { // convert CRLF or CRCRLF to LF
    if (buf[i] === CR) {
      crCount++;
      if (i + 1 === bufLen) {
        context.orphanCrCount = Math.min(crCount, requiredCrCount); //mark as orphan CR
        startPos < bufLen - context.orphanCrCount && bufAry.push(buf.slice(startPos, bufLen - context.orphanCrCount));
        return bufAry;
      }
    } else {
      if (crCount >= requiredCrCount && buf[i] === LF) {
        bufAry.push(buf.slice(startPos, i - requiredCrCount));
        startPos = i;
      }
      crCount = 0;
    }
  }
  bufAry.push(buf.slice(startPos));
  return bufAry;
}

//****************************************************************************************
function getOrCreateDevCtx(device/*device serial number*/) {
  !devMgr[device] && scheduleUpdateWholeUI();
  return devMgr[device] || (devMgr[device] = {device: device, info: '', status: '', touchStatus: '', touch: {}, accessKey: newAutoAccessKeyIfStreamWebPublic(), accessKeyTimestamp: ''});
}
function newAutoAccessKeyIfStreamWebPublic() {
  return isLocalOnlyIP(cfg.streamWeb_ip) ? '' : 'auto_' + crypto.createHash('md5').update(cfg.adminKey + Date.now() + Math.random()).digest('hex');
}

function scanAllDevices(mode/* 'checkPrepare', 'forcePrepare', undefined means repeatScanInBackground */, on_gotAllRealDev) {
  return spawn('[GetAllDevices]', cfg.adb, cfg.adbOption.concat('devices'), function/*on_close*/(ret, stdout) {
    var deviceList = [], parts;
    if (ret === 0) {
      stdout.split('\n').slice(1/*from second line*/).forEach(function (lineStr) {
        if ((parts = lineStr.split('\t')).length > 1) {
          var device = parts[0];
          if (/[^?]/.test(device) && deviceList.indexOf(device) < 0) { //exclude SN such as ??????
            deviceList.push(device);
            var dev = getOrCreateDevCtx(device);
            (dev.status === ERR_DEV_NOT_FOUND || !dev.status) && log('[GetAllDevices] device connected: ' + device);
            dev.status === ERR_DEV_NOT_FOUND && (cfg.showDisconnectedDevices ? scheduleUpdateLiveUI() : scheduleUpdateWholeUI());
            dev.status === ERR_DEV_NOT_FOUND && (dev.status = dev.touchStatus = '');
            (mode || !dev.status) && prepareDeviceFile(dev, mode === 'forcePrepare');
          }
        }
      });
    }
    forEachValueIn(devMgr, function (dev) {
      if (deviceList.indexOf(dev.device) < 0 && dev.status !== ERR_DEV_NOT_FOUND) {
        dev.status && log('[GetAllDevices] device disconnected: ' + dev.device);
        dev.status = ERR_DEV_NOT_FOUND;
        cfg.showDisconnectedDevices ? scheduleUpdateLiveUI() : scheduleUpdateWholeUI();
      }
    });
    on_gotAllRealDev && on_gotAllRealDev(deviceList);
    !mode && deviceList.forEach(function (device) {
      if (devMgr[device].status === 'OK' && Date.now() - (devMgr[device].lastKeepAliveDateMs || 0) >= cfg.adbKeepDeviceAliveInterval * 1000) {
        devMgr[device].lastKeepAliveDateMs = Date.now();
        spawn('[KeepAlive]', cfg.adb, cfg.adbOption.concat('-s', device, 'shell', 'echo', 'alive'), {timeout: cfg.adbEchoTimeout * 1000, noDetailLog: !cfg.logAllAdbCommands});
      }
    });
  }, {timeout: Math.min(cfg.adbDeviceListUpdateInterval, cfg.adbGetDeviceListTimeout) * 1000, noDetailLog: !cfg.logAllAdbCommands}); //end of GetAllDevices
}

var ADB_GET_DEV_BASIC_INFO_CMD_ARGS = ['echo', '====;', 'getprop', 'ro.product.model;', 'getprop', 'ro.build.version.incremental;', 'getprop', 'ro.product.manufacturer;', 'getprop', 'ro.build.version.release;', 'getprop', 'ro.build.version.sdk;', 'getprop', 'ro.product.cpu.abi;',
  'echo', '====;', 'getevent' , '-pS', ';'];
var ADB_GET_DEV_EXTRA_INFO_CMD_ARGS = ['echo', '====;', 'cd', cfg.androidWorkDir, '||', 'exit', ';', 'dumpsys', 'window', 'policy', '|', './busybox', 'grep', '-E', '"mUnrestrictedScreen=|DisplayWidth="', ';',
  'echo', '====;', './busybox', 'grep', '-Ec', '"^processor"', '/proc/cpuinfo', ';',
  'echo', '====;', 'export', 'LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.', ';', './dlopen', './get-raw-image-420', './get-raw-image-400', './get-raw-image-220', '2>/dev/null;'];

function prepareDeviceFile(dev, force/*optional*/) {
  if (!(dev.status === 'OK' && !force || dev.status === 'preparing')) {
    log('[PrepareDeviceFile for ' + dev.device + '] begin');
    dev.status = 'preparing';
    scheduleUpdateLiveUI();
    var on_complete = function (err) {
      log('[PrepareFileToDevice ' + dev.device + '] ' + (err || 'OK'));
      dev.status = err || 'OK';
      scheduleUpdateLiveUI();
    };
    spawn('[CheckDevice ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', 'cat', cfg.androidWorkDir + '/version;', ADB_GET_DEV_BASIC_INFO_CMD_ARGS, ADB_GET_DEV_EXTRA_INFO_CMD_ARGS), function/*on_close*/(ret, stdout, stderr) {
      if (ret !== 0) {
        return on_complete(stringifyError(stderr) || 'unknown error: failed to check device');
      }
      var parts = stdout.trim().split(/\s*====\s*/);
      if (parts.length < 4) {
        return on_complete('unknown error: failed to check device');
      }
      dev.CrCount = Math.max(0, stdout.match(/\r?\r?\n$/)[0].length - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/);
      dev.info = parts[1].replace(/\r*\n/g, ' ');
      dev.sysVer = parts[1].split(/\r*\n/)[3].replace(/^\d+\.\d+$/, '$&.0'); // 9.9 -> 9.9.0
      dev.makerName = parts[1].split(/\r*\n/)[2].toUpperCase();
      dev.armv = (dev.armv = Number(parts[1].split(/\r*\n/)[5].replace(/\D/g, ''))) >= 7 ? 7 : 5; //remove non-digit char and convert to number
      getTouchDeviceInfo(dev, parts[2]);
      getDispSize(dev, parts[3]);
      dev.cpuCount = Number(parts[4]);
      if (parts[0] === prepareDeviceFile.ver && !force && (dev.so_file = parts[5] && parts[5].trim())) {
        return on_complete();
      }
      return spawn('[PushFileToDevice ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'push', './android', cfg.androidWorkDir), function/*on_close*/(ret, stdout, stderr) {
        if (ret !== 0) {
          return on_complete(stringifyError(stderr.replace(/push: .*|\d+ files pushed.*|.*KB\/s.*/g, '')) || 'unknown error: failed to push file to device');
        }
        return spawn('[FinishPrepareFile ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', 'chmod', '755', cfg.androidWorkDir + '/*', '&&', 'echo', prepareDeviceFile.ver, '>', cfg.androidWorkDir + '/version;', ADB_GET_DEV_EXTRA_INFO_CMD_ARGS), function/*on_close*/(ret, stdout, stderr) {
          if (ret !== 0) {
            return on_complete(stringifyError(stderr) || 'unknown error: failed to finish preparing device file');
          }
          var parts = stdout.trim().split(/\s*====\s*/);
          if (parts.length !== 4) {
            return on_complete('unknown error: failed to finish preparing device file');
          }
          if (parts[0]) {
            return on_complete(stringifyError(parts[0]));
          }
          getDispSize(dev, parts[1]);
          dev.cpuCount = Number(parts[2]);
          if (!(dev.so_file = parts[3] && parts[3].trim())) {
            return on_complete('unknown error: prepareFile OK but failed to check internal so files');
          }
          setDeviceOrientation(dev, 'free');
          return on_complete();
        }, {timeout: cfg.adbFinishPrepareFileTimeout * 1000}); //end of FinishPrepareFile
      }, {timeout: cfg.adbPushFileToDeviceTimeout * 1000}); //end of PushFileToDevice
    }, {timeout: cfg.adbCheckDeviceTimeout * 1000}); //end of CheckDevice
  }
}
function getDispSize(dev, stdout) {
  if ((stdout = stdout && stdout.match(/(\d\d+)\D+(\d\d+)/))) {
    var _w = Number(stdout[1]), _h = Number(stdout[2]);
    dev.disp_w = Math.min(_w, _h);
    dev.disp_h = Math.max(_w, _h);
  }
}
function getTouchDeviceInfo(dev, stdout) {
  dev.touchStatus = 'error: touch device not found' /*do not change this string*/;  //almost impossible
  dev.touch.modernStyle = stdout.indexOf('INPUT_PROP_DIRECT') >= 0;
  stdout.split(/add device \d+: /).some(function (devInfo) {
    var match = {};
    if ((match['0030'] = devInfo.match(/\D*0030.*value.*min.*max\D*(\d+)/)) /*ABS_MT_TOUCH_MAJOR*/ &&
        (match['0035'] = devInfo.match(/\D*0035.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_X*/ &&
        (match['0036'] = devInfo.match(/\D*0036.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_Y*/ &&
        (match['0039'] = devInfo.match(/\D*0039.*value.*min.*max\D*(\d+)/)) /*ABS_MT_TRACKING_ID*/) {
      if ((dev.touch.modernStyle && devInfo.indexOf('INPUT_PROP_DIRECT') >= 0) ||
          (!dev.touch.modernStyle && !devInfo.match(/\n +name: +.*pen/))) {
        dev.touch.w = Math.floor((Number(match['0035'][1]) + 1) / 2) * 2;
        dev.touch.h = Math.floor((Number(match['0036'][1]) + 1) / 2) * 2;
        if (!dev.touch.w || !dev.touch.h) {
          log('[GetTouchDevInfo ' + dev.device + ']' + ' strange: max_x=' + match['0035'][1] + ' max_y=' + match['0036'][1]);
        } else {
          dev.touch.avgContactSize = Math.max(Math.ceil(match['0030'][1] / 2), 1);
          dev.touch.maxTrackId = Number(match['0039'][1]);
          (match['003a'] = devInfo.match(/\D*003a.*value.*min.*max\D*(\d+)/)) && (dev.touch.avgPressure = Math.max(Math.ceil(match['003a'][1] / 2), 1)); //ABS_MT_PRESSURE
          (match['0032'] = devInfo.match(/\D*0032.*value.*min.*max\D*(\d+)/)) && (dev.touch.avgFingerSize = Math.max(Math.ceil(match['0032'][1] / 2), 1)); //ABS_MT_WIDTH_MAJOR
          dev.touch.needBtnTouchEvent = /\n +KEY.*:.*014a/.test(devInfo); //BTN_TOUCH for sumsung devices
          dev.touch.cmdHead = 'sendevent ' + devInfo.match(/.*/)[0]; //get first line: /dev/input/eventN
          dev.touchStatus = 'OK';
          return true;
        }
      }
    }
    return false;
  });
  log('[GetTouchDevInfo ' + dev.device + ']' + ' ' + dev.touchStatus + ' ' + (dev.touchStatus === 'OK' ? JSON.stringify(dev.touch) : ''));
}
function sendTouchEvent(dev, q) {
  var x = (q.x * dev.touch.w).toFixed(), y = (q.y * dev.touch.h).toFixed(), cmd = '';
  if (!(q.type === 'm' && dev.touchLast_x === x && dev.touchLast_y === y)) { //ignore move event if at same position
    if (dev.touch.maxTrackId === 65535) {
      if (q.type === 'd') { //down
        cmd += dev.touch.cmdHead + ' 3 ' + 0x39 + ' 0; '; //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
        dev.touch.needBtnTouchEvent && (cmd += dev.touch.cmdHead + ' 1 ' + 0x014a + ' 1; '); //BTN_TOUCH DOWN for sumsung devices
        cmd += dev.touch.cmdHead + ' 3 ' + 0x30 + ' ' + dev.touch.avgContactSize + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
        if (dev.touch.avgPressure) {
          cmd += dev.touch.cmdHead + ' 3 ' + 0x3a + ' ' + dev.touch.avgPressure + '; '; //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
        } else if (dev.touch.avgFingerSize) {
          cmd += dev.touch.cmdHead + ' 3 ' + 0x32 + ' ' + dev.touch.avgFingerSize + '; '; //ABS_MT_WIDTH_MAJOR 0x32 /* Major axis of approaching ellipse */
        }
        cmd += dev.touch.cmdHead + ' 3 ' + 0x35 + ' ' + x + '; '; //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
        cmd += dev.touch.cmdHead + ' 3 ' + 0x36 + ' ' + y + '; '; //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
      } else if (q.type === 'm') { //move
        x !== dev.touchLast_x && (cmd += dev.touch.cmdHead + ' 3 ' + 0x35 + ' ' + x + '; '); //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
        y !== dev.touchLast_y && (cmd += dev.touch.cmdHead + ' 3 ' + 0x36 + ' ' + y + '; '); //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
      } else { //up, out
        cmd += dev.touch.cmdHead + ' 3 ' + 0x39 + ' -1; '; //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
        dev.touch.needBtnTouchEvent && (cmd += dev.touch.cmdHead + ' 1 ' + 0x014a + ' 0; ');  //BTN_TOUCH UP for sumsung devices
      }
      cmd += dev.touch.cmdHead + ' 0 0 0; '; //SYN_REPORT
    }
    else { //for some old devices such as galaxy SC-02B (android 2.2, 2.3)
      cmd += dev.touch.cmdHead + ' 3 ' + 0x39 + ' 0; '; //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
      cmd += dev.touch.cmdHead + ' 3 ' + 0x35 + ' ' + x + '; '; //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
      cmd += dev.touch.cmdHead + ' 3 ' + 0x36 + ' ' + y + '; '; //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
      if (q.type === 'd' || q.type === 'm') { //down, move
        cmd += dev.touch.cmdHead + ' 3 ' + 0x30 + ' ' + dev.touch.avgContactSize + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
        dev.touch.avgPressure && (cmd += dev.touch.cmdHead + ' 3 ' + 0x3a + ' ' + dev.touch.avgPressure + '; '); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
      } else { //up, out
        cmd += dev.touch.cmdHead + ' 3 ' + 0x30 + ' ' + 0 + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
        dev.touch.avgPressure && (cmd += dev.touch.cmdHead + ' 3 ' + 0x3a + ' ' + 0 + '; '); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
      }
      cmd += dev.touch.cmdHead + ' 0 2 0; '; //SYN_MT_REPORT   this is very important
      if (dev.touch.needBtnTouchEvent && (q.type === 'd' || q.type === 'u' || q.type === 'o')) {
        cmd += dev.touch.cmdHead + ' 1 ' + 0x014a + ' ' + (q.type === 'd' ? 1 : 0) + '; '; //BTN_TOUCH DOWN for sumsung devices
      }
      cmd += dev.touch.cmdHead + ' 0 0 0; '; //SYN_REPORT
    }

    cmd && !dev.touchShell && (dev.touchShell = spawn('[Touch ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell'), function/*on_close*/() {
      dev.touchShell = null;
    }, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'pipe'/*stderr*/]}));
    cmd && cfg.logAllAdbCommands && log(cmd, {head: '[Touch ' + dev.device + ']' + ' exec: '});
    cmd && dev.touchShell.stdin.write(cmd + '\n');

    if (q.type === 'd' || q.type === 'm') { //down, move
      dev.touchLast_x = x;
      dev.touchLast_y = y;
    }
  }
}
function setDeviceOrientation(dev, orientation) {
  return spawn('[SetOrientation ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', 'cd ' + cfg.androidWorkDir + '; ls -d /data/data/jp.sji.sumatium.tool.screenorientation >/dev/null 2>&1 || (echo install ScreenOrientation.apk; pm install ./ScreenOrientation.apk 2>&1 | ./busybox grep -Eo \'^Success$|\\[INSTALL_FAILED_ALREADY_EXISTS\\]\') && am startservice -n jp.sji.sumatium.tool.screenorientation/.OrientationService -a ' + orientation + (dev.sysVer >= '4.2.2' ? ' --user 0' : '')), {timeout: cfg.adbSetOrientationTimeout * 1000});
}

function chkCaptureParameter(q, force_ajpg) {
  var dev = q.device && devMgr[q.device], match, w, h;
  if (q.device && !(dev && dev.status === 'OK') && (chk.err = 'error: device not ready')
      || !chk('type', q.type = force_ajpg ? 'ajpg' : q.type || 'ajpg', ['ajpg', 'jpg'])
      || !chk('fps', (q.fps = Number(q.fps)), cfg.minFps, cfg.maxFps)
      || q.scale && !(match = q.scale.match(/^([1-9]\d{1,3})x([1-9]\d{1,3})$|^([1-9]\d{1,3})xAuto$|^Autox([1-9]\d{1,3})$/)) && (chk.err = '`scale`: must be in pattern "9999x9999" or "9999xAuto" or "Auto' + 'x9999"')
      || q.rotate && !chk('rotate', (q.rotate = Number(q.rotate)), [0, 270])) {
    return false;
  }
  q._FpsScaleRotate = 'f' + q.fps;
  (q.scale = q.scale || '') && (q._FpsScaleRotate += ((w = Number(match[1] || match[3])) ? 'w' + w : '') + ((h = Math.max(Number(match[2] || match[4]), w + 2)) ? 'h' + h : ''));
  (q.rotate = q.rotate || '') && (q._FpsScaleRotate += 'r' + q.rotate);
  if (dev) {
    q._FpsScaleRotateDisp = 'Fps:' + q.fps;
    if (q.scale) {
      if (dev.disp_w && dev.disp_h) {
        var _w = Math.ceil((w || dev.disp_w / dev.disp_h * h) / 2) * 2, _h = Math.ceil((h || dev.disp_h / dev.disp_w * w) / 2) * 2;
        q._FpsScaleRotateDisp += ' Size:' + _w + 'x' + _h;
        q._filter = 'scale=' + _w + ':' + _h;
      } else {
        q._FpsScaleRotateDisp += ' Size:' + q.scale;
        q._filter = 'scale=' + 'ceil(' + (w || ('iw/ih*' + h) ) + '/2)*2' + ':' + 'ceil(' + (h || ('ih/iw*' + w) ) + '/2)*2';
      }
    }
    q.rotate && (q._FpsScaleRotateDisp += ' Landscape');
    q.rotate && (q._filter = (q._filter ? q._filter + ',' : '') + 'transpose=2');
  }
  q.timestamp = getTimestamp();
  return true;
}
function capture(outputStream, q) {
  var res = outputStream, dev = devMgr[q.device], provider = dev.liveStreamer;
  if (!provider) {
    provider = dev.liveStreamer = {consumerMap: {}, q: q, frameIndex: 0, bufAry: []};
    var childProc = provider.__childProc = spawn('[CAP ' + q.device + ' ' + q._FpsScaleRotate + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell',
        '(', 'date', '>&2;', 'export', 'LD_LIBRARY_PATH=$LD_LIBRARY_PATH:' + cfg.androidWorkDir, ';', //just for android 2.3- bug which can not open shared library with relative path
        cfg.androidWorkDir + '/busybox', 'stty', '-onlcr'/*disable LF->CRLF*/, '>&2', '&&',
        cfg.androidWorkDir + '/ffmpeg.armv' + dev.armv, '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
        '-f', 'androidgrab', '-r', q.fps, '-i', dev.so_file, (q._filter ? ['-vf', '\'' + q._filter + '\''] : []),
        '-f', 'mjpeg', '-q:v', '1', '-'/*output to stdout*/,
        ')', '2>', cfg.androidLogPath
    ), {noLogStdout: true});
    childProc.on('close', function () {
      forEachValueIn(provider.consumerMap, endCaptureConsumer, childProc.__err);
      provider === dev.liveStreamer && clearTimeout(provider.delayKillTimer);
      provider === dev.liveStreamer && scheduleUpdateLiveUI();
      provider === dev.liveStreamer && (dev.liveStreamer = null);
    });
    childProc.stdout.on('data', function (buf) {
      convertCRLFToLF(provider/*context*/, dev.CrCount, buf).forEach(function (buf) {
        var pos = 0, unsavedStart = 0, endPos = buf.length;
        for (; pos < endPos; pos++) {
          if (provider.foundMark && buf[pos] === 0xD9) {
            provider.bufAry.push(buf.slice(unsavedStart, pos + 1));
            provider.lastImage = Buffer.concat(provider.bufAry);
            provider.bufAry.length = 0;
            unsavedStart = pos + 1;
            provider.frameIndex++;
            provider.foundMark = false;
            forEachValueIn(provider.consumerMap, function (res) {
              if (res.setHeader) { //------------------for http response ----------------
                if (res.q.type === 'ajpg') {
                  if (res.headersSent && res.output/*unsent data array*/ && res.output.length) {
                    log(res.__tag + ' drop ' + res.output.length + ' frames');
                    res.__droppedFrames = (res.__droppedFrames || 0) + res.output.length;
                    res.output.length = res.outputEncodings.length = 0;
                  } else { //output continuous jpg. Note: write next content-type earlier to force Chrome draw image immediately
                    write(res, Buffer.concat([res.__bytesWritten ? EMPTY_BUF : MULTIPART_INNER_HEAD, provider.lastImage, MULTIPART_CRLF_INNER_HEAD]));
                    res.__sentFrames = (res.__sentFrames || 0) + 1;
                  }
                } else { //output single jpg and end
                  write(res, provider.lastImage);
                  endCaptureConsumer(res, 'single jpg finished');
                }
              } else { //----------------------------for non-http output stream ...----------------
                write(res, provider.lastImage);
                res.__sentFrames = (res.__sentFrames || 0) + 1;
              }
            });//end of consumer enum
          } else {
            provider.foundMark = (buf[pos] === 0xff);
          }
        } //end of for loop in buffer
        unsavedStart < endPos && provider.bufAry.push(buf.slice(unsavedStart, endPos));
      });
    });
    childProc.stderr.on('data', function (buf) {
      forEachValueIn(provider.consumerMap, endCaptureConsumer, stringifyError(buf.toString()) || 'unknown error: strange output of capture process');
    });
    dev.sysVer > '2.3.0' && spawn('[TurnScreenOn ' + q.device + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', 'dumpsys', 'power', '|', (dev.sysVer >= '4.2.2' ? 'grep' : [cfg.androidWorkDir + '/busybox', 'grep']), '-q', (dev.sysVer >= '4.2.2' ? 'mScreenOn=false' : 'mPowerState=0'), '&&', '(', 'input', 'keyevent', 26, ';', 'input', 'keyevent', 0, ')'), {timeout: cfg.adbTurnScreenOnTimeout * 1000});
  }
  provider.consumerMap[res.__tag] = res;
  scheduleUpdateLiveUI();
  clearTimeout(provider.delayKillTimer);
  res.q = q;
  res.on('close', function () { //closed by http peer or underline stream is closed directly
    endCaptureConsumer(res, 'canceled'/*do not change this string*/);
  });
  q.type === 'ajpg' && (res.__statTimer = setInterval(function () {
    (cfg.logFpsStatistic || res.__droppedFrames) && log(provider.__childProc.__tag + res.__tag + ' statistics: Fps=' + ((res.__sentFrames || 0) / cfg.fpsStatisticInterval).toPrecision(3) + (res.__droppedFrames ? ' total dropped frames: ' + res.__droppedFrames : 0));
    res.__sentFrames = 0;
  }, cfg.fpsStatisticInterval * 1000));
  res.setHeader && res.setHeader('Content-Type', res.q.type === 'ajpg' ? 'multipart/x-mixed-replace;boundary=MULTIPART_BOUNDARY' : 'image/jpeg');
  q.type !== 'ajpg' && provider.lastImage && write(res, provider.lastImage);
  q.type !== 'ajpg' && provider.lastImage && endCaptureConsumer(res);
}
function endCaptureConsumer(res/*Any Type Output Stream*/, reason) {
  var dev = devMgr[res.q.device], provider = dev.liveStreamer;
  if (provider && provider.consumerMap[res.__tag] === res) {
    delete provider.consumerMap[res.__tag];
    scheduleUpdateLiveUI();
    reason !== 'canceled' && end(res, res.__bytesWritten ? undefined : reason);
    clearTimeout(res.__recordTimer);
    clearInterval(res.__statTimer);
    if (Object.keys(provider.consumerMap).length === 0) {
      if (reason === 'stop on demand') {
        clearTimeout(provider.delayKillTimer);
        dev.liveStreamer = null;
        provider.__childProc.kill('SIGKILL');
      } else if (childProcMap[provider.__childProc.pid]) {
        provider.delayKillTimer = setTimeout(function () {
          dev.liveStreamer = null;
          provider.__childProc.kill('SIGKILL');
          scheduleUpdateLiveUI();
        }, cfg.adbCaptureExitDelayTime * 1000);
      }
    }
  }
}
function startRecording(q/*same as capture*/) {
  var origFilename = querystring.escape(q.device) + '~rec_' + q._FpsScaleRotate + '_' + q.timestamp + '.ajpg';
  var childProc = spawn('[REC ' + q.device + ' ' + q._FpsScaleRotate + ']', cfg.ffmpeg, [].concat(
      '-y' /*overwrite output*/, '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
      '-f', 'mjpeg', '-r', q.fps, '-i', '-'/*stdin*/, '-pix_fmt', 'yuv420p'/*for safari mp4*/,
      cfg.outputDir + '/' + origFilename + '.mp4', (cfg.alsoRecordAsWebM ? cfg.outputDir + '/' + origFilename + '.webm' : [])
  ), {stdio: ['pipe'/*stdin*/, 'pipe'/*stdout*/, 'pipe'/*stderr*/]});
  childProc.stdin.__recordTimer = global.setTimeout(endCaptureConsumer, cfg.maxRecordTime * 1000, childProc.stdin, 'recording time is too long');
  childProc.stdin.__tag = REC_TAG;
  capture(childProc.stdin, q);
  return 'OK: ' + origFilename + '.mp4' + (cfg.alsoRecordAsWebM ? ' ' + origFilename + '.webm' : '');
}

function scheduleUpdateLiveUI() {
  clearTimeout(status.updateLiveUITimer);
  status.updateLiveUITimer = setTimeout(function () {
    if (Object.keys(status.consumerMap).length) {
      var sd = {}, json;
      sd['discoveringStatus'] = status.discoveringIp ? (status.discoveringIp + ' (Click to Cancel)' ) : '';
      forEachValueIn(devMgr, function (dev) {
        if (dev.status !== ERR_DEV_NOT_FOUND || cfg.showDisconnectedDevices) {
          var id = htmlIdEncode(dev.device);
          var recordCount = dev.liveStreamer && dev.liveStreamer.consumerMap[REC_TAG] ? 1 : 0;
          var liveViewCount = dev.liveStreamer ? (Object.keys(dev.liveStreamer.consumerMap).length - recordCount) : 0;
          sd['liveViewCount_' + id] = liveViewCount ? '(' + liveViewCount + ')' : '';
          sd['recordingCount_' + id] = recordCount ? '(' + recordCount + ')' : '';
          sd['devInfo_' + id] = dev.info + (dev.cpuCount ? (' ' + dev.cpuCount + 'CPU') : '') + (dev.disp_w && dev.disp_h ? (' ' + dev.disp_w + 'x' + dev.disp_h) : '');
          sd['devStatus_' + id] = dev.status + (dev.status === 'OK' ? ' (Touch:' + dev.touchStatus + ')' : '');
          sd['captureParameter_' + id] = dev.liveStreamer ? dev.liveStreamer.q._FpsScaleRotateDisp : '';
          sd['captureTimestamp_' + id] = dev.liveStreamer ? stringifyTimestampShort(dev.liveStreamer.q.timestamp) : '';
        }
      });
      if ((json = JSON.stringify(sd)) !== status.lastDataJson) {
        status.lastDataJson = json;
        status.ver = getTimestamp();
      }
      json = '{"appVer":"' + status.appVer + '", "ver":"' + status.ver + '","data":' + json + '}';
      forEachValueIn(status.consumerMap, function (res) {
        if (res.__previousVer !== status.ver || res.__previousAppVer !== status.appVer) {
          end(res, json, 'text/json');
          delete status.consumerMap[res.__tag];
        }
      });
    }
  }, 0);
}
function scheduleUpdateWholeUI() {
  clearTimeout(status.updateWholeUITimer);
  status.updateWholeUITimer = setTimeout(function () {
    status.appVer = getTimestamp();
    var json = '{"appVer":"' + status.appVer + '"}';
    forEachValueIn(status.consumerMap, function (res) {
      end(res, json, 'text/json'); //cause browser to refresh page
    });
    status.consumerMap = {};
  }, 0);
}

function setDefaultHttpHeaderAndInitCloseHandler(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private, proxy-revalidate, s-maxage=0'); // HTTP 1.1.
  res.setHeader('Pragma', 'no-cache'); // HTTP 1.0.
  res.setHeader('Expires', 0); // Proxies.
  res.setHeader('Vary', '*'); // Proxies.
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.on('close', function () { //closed by http peer
    res.__isClosed = true;
    res.__logReq && log(res.__tag + ' CLOSED by peer');
  });
  res.on('finish', function () { //response stream have been flushed and ended without log, such as .pipe()
    res.__logReq && !res.__isEnded && log(res.__tag + ' END');
  });
}
function replaceCommonDeviceVarInHtml(html, dev) {
  return html.replace(/@device\b/g, querystring.escape(dev.device))
      .replace(/#device\b/g, htmlEncode(dev.device)).replace(/\$device\b/g, htmlIdEncode(dev.device))
      .replace(/@accessKey\b/g, querystring.escape(dev.accessKey)).replace(/#accessKey\b/g, htmlEncode(dev.accessKey));
}

function streamWeb_handler(req, res) {
  if (req.url.length > 4096 || req.method !== 'GET' || req.url === '/favicon.ico') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, urlExt = Path.extname(urlPath), dev = q.device && devMgr[q.device];
  res.__logReq = cfg.logAllHttpRequests || !(urlExt === '.html' || urlExt === '.js' || urlExt === '.css' || (q.type === 'jpg' && q.timestamp));
  res.__logReq && log((res.__tag = '[' + cfg.streamWeb_protocol + '_' + (res.seq = ++httpSeq) + ']') + ' ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (cfg.logHttpReqDetail ? ' [from ' + req.connection.remoteAddress + ':' + req.connection.remotePort + ']' : ''));
  if (urlExt === '.js' || urlExt === '.css') {
    return end(res, htmlCache[urlPath], urlExt === '.css' ? 'text/css' : urlExt === '.js' ? 'text/javascript' : '');
  }
  if (!dev && (chk.err = '`device`: unknown device') || dev.accessKey && q.accessKey !== dev.accessKey && (chk.err = 'access denied')) {
    return end(res, chk.err);
  }
  setDefaultHttpHeaderAndInitCloseHandler(res);
  !q.adminKey && req.headers.cookie && (q.adminKey = req.headers.cookie.match(re_adminKey_cookie))
  && (q.adminKey = querystring.unescape(q.adminKey[1]));

  switch (urlPath) {
    case '/capture': //---------------------------send capture result to browser & optionally save to file------------
      if (!chkCaptureParameter(q, /*force_ajpg:*/false)) {
        return end(res, chk.err);
      }
      return capture(res, q);
    case '/saveImage': //------------------------------Save Current Image From Live View------------------------------
      if (!dev.liveStreamer || !dev.liveStreamer.lastImage) {
        return end(res, 'error: no live image');
      }
      q.filename = querystring.escape(q.device) + '~live_' + dev.liveStreamer.q._FpsScaleRotate + '_' + dev.liveStreamer.q.timestamp + '.ajpg~frame' + String.fromCharCode(65 + String(dev.liveStreamer.frameIndex).length - 1) + dev.liveStreamer.frameIndex + '.jpg';
      fs.writeFile(cfg.outputDir + '/' + q.filename, dev.liveStreamer.lastImage, function (err) {
        return end(res, stringifyError(err));
      });
      return end(res, 'OK: ' + q.filename);
    case '/liveViewer.html':  //-------------------------show live capture (Just as a sample) ------------------------
      if (!chkCaptureParameter(q, /*force_ajpg:*/true)) {
        return end(res, chk.err);
      }
      return end(res, replaceCommonDeviceVarInHtml(htmlCache[urlPath], dev)
          .replace(/@minFps\b/g, cfg.minFps).replace(/@maxFps\b/g, cfg.maxFps)
          .replace(/@fps\b/g, dev.liveStreamer ? dev.liveStreamer.q.fps : q.fps).replace(/@scale\b/g, dev.liveStreamer ? dev.liveStreamer.q.scale : q.scale).replace(/@rotate\b/g, dev.liveStreamer ? dev.liveStreamer.q.rotate : q.rotate)
          .replace(new RegExp('_selectedIf_rotate_' + (q.rotate || '0'), 'g'), 'selected')
          .replace(/_capture_param_changed\b/g, dev.liveStreamer && q._FpsScaleRotate !== dev.liveStreamer.q._FpsScaleRotate ? 'capture_param_changed' : '')
          , 'text/html');
    case '/videoViewer.html': //--------------------show video file  (Just as a sample)-------------------------------
    case '/imageViewer.html': //--------------------show image file  (Just as a sample)-------------------------------
      if (!cfg.enableGetOutputFile && !(cfg.adminKey && q.adminKey === cfg.adminKey)) {
        return end(res, 'access denied');
      }
      return fs.readdir(cfg.outputDir, function (err, filenameAry) {
        if (err) {
          return end(res, stringifyError(err));
        }
        var filenameMap = {/*sortKey:*/}, isImage = (urlPath === '/imageViewer.html'), recordingTimestamp = dev.liveStreamer && dev.liveStreamer.consumerMap[REC_TAG] && dev.liveStreamer.consumerMap[REC_TAG].q.timestamp;
        filenameAry.forEach(function (filename) {
          (filename = new FilenameInfo(filename, q.device)).isValid && isImage === (filename.type === 'jpg') && (filename.origTimestamp !== recordingTimestamp)
          && (filenameMap[isImage ? filename.toString() : filename.origTimestamp] = filename);
        });
        var sortedKeys = Object.keys(filenameMap).sort().reverse();
        if (!isImage) { //videoViewer
          if (!(q.filename = filenameMap[sortedKeys[q.fileindex = Number(q.fileindex) || 0]])) {
            return end(res, sortedKeys.length ? '`fileindex`: file not found' : 'error: file not found');
          }
          return end(res, replaceCommonDeviceVarInHtml(htmlCache[urlPath], dev)
              .replace(/@fileindex\b/g, q.fileindex).replace(/@origFilename\b/g, querystring.escape(q.filename.origFilename))
              .replace(/@timestamp\b/g, stringifyTimestampShort(q.filename.origTimestamp))
              .replace(/@fileCount\b/g, sortedKeys.length).replace(/@maxFileindex\b/g, sortedKeys.length - 1)
              .replace(/@olderFileindex\b/g, Math.min(q.fileindex + 1, sortedKeys.length - 1)).replace(/@newerFileindex\b/g, Math.max(q.fileindex - 1, 0))
              .replace(/@fileSize_mp4\b/g, getFileSizeSync(cfg.outputDir + '/' + q.filename.origFilename + '.mp4').toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","))
              .replace(/@fileSize_webm\b/g, getFileSizeSync(cfg.outputDir + '/' + q.filename.origFilename + '.webm').toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","))
              .replace(/_unprotect&/g, q.adminKey ? 'adminKey=' + querystring.escape(q.adminKey) + '&' : '')
              , 'text/html');
        } else {
          return end(res, replaceCommonDeviceVarInHtml(htmlCache[urlPath], dev)
              .replace(/@count\b/g, sortedKeys.length)
              .replace(/_unprotect&/g, q.adminKey ? 'adminKey=' + querystring.escape(q.adminKey) + '&' : '')
              .replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
                return sortedKeys.reduce(function (joinedStr, key) {
                  return joinedStr + htmlBlock.replace(/@filename\b/g, querystring.escape(filenameMap[key]));
                }, ''/*initial joinedStr*/);
              }), 'text/html');
        }
      });
    case '/getFile': //---------------------------get video/image file------------------------------------------------
      if (!cfg.enableGetOutputFile && !(cfg.adminKey && q.adminKey === cfg.adminKey) && (chk.err = 'access denied')
          || !(q.filename = new FilenameInfo(q.filename, q.device)).isValid && (chk.err = '`filename`: invalid name')) {
        return end(res, chk.err);
      }
      if ((q._range = (req.headers.range || '').match(re_httpRange))) {
        if (!(q._fileSize = getFileSizeSync(cfg.outputDir + '/' + q.filename))) {
          return end(res, chk.err);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        q._range.start = q._range[1] && Math.min(Number(q._range[1]), q._fileSize - 1) || 0;
        q._range.end = q._range[2] && Math.min(Math.max(Number(q._range[2]), q._range.start), q._fileSize - 1) || (q._fileSize - 1);
        res.setHeader('Content-Range', 'bytes ' + q._range.start + '-' + q._range.end + '/' + q._fileSize);
        res.setHeader('Content-Length', q._range.end - q._range.start + 1);
        res.statusCode = 206/*Partial Content*/;
      }
      q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + q.filename);
      res.setHeader('Content-Type', q.filename.type === 'mp4' ? 'video/mp4' : q.filename.type === 'webm' ? 'video/webm' : q.filename.type === 'jpg' ? 'image/jpeg' : '');
      return fs.createReadStream(cfg.outputDir + '/' + q.filename, q._range)
          .on('error',function (err) {
            end(res, stringifyError(err));
          }).pipe(res);
    case '/touch':
      if (!chk('type', q.type, ['d', 'u', 'o', 'm']) || !chk('x', q.x = Number(q.x), 0, 1) || !chk('x', q.y = Number(q.y), 0, 1)) {
        return end(res, JSON.stringify(chk.err), 'text/json');
      }
      if (!dev.liveStreamer || !dev.liveStreamer.lastImage) {
        return end(res, JSON.stringify('device is not being live viewed'), 'text/json');
      }
      if (dev.touchStatus !== 'OK') {
        return end(res, JSON.stringify(dev.touchStatus || 'not prepared'), 'text/json');
      } else {
        sendTouchEvent(dev, q);
        return end(res, JSON.stringify('OK'), 'text/json');
      }
    case '/sendKey':
      if (!chk('keyCode', q.keyCode = Number(q.keyCode), [3, 4, 82, 26, 187])) {
        return end(res, chk.err);
      }
      spawn('[SendKey ' + q.device + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', 'input', 'keyevent', q.keyCode), {timeout: cfg.adbSendKeyTimeout * 1000});
      return end(res, 'OK');
    case '/turnScreenOn':
      dev.sysVer > '2.3.0' && spawn('[TurnScreenOn ' + q.device + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', 'dumpsys', 'power', '|', (dev.sysVer >= '4.2.2' ? 'grep' : [cfg.androidWorkDir + '/busybox', 'grep']), '-q', (dev.sysVer >= '4.2.2' ? 'mScreenOn=false' : 'mPowerState=0'), '&&', '(', 'input', 'keyevent', 26, ';', 'input', 'keyevent', 0, ')'), {timeout: cfg.adbTurnScreenOnTimeout * 1000});
      return end(res, 'OK');
    case '/setOrientation':
      if (!chk('orientation', q.orientation, ['landscape', 'portrait', 'free'])) {
        return end(res, chk.err);
      }
      setDeviceOrientation(dev, q.orientation);
      return end(res, 'OK');
    default:
      return end(res, 'bad request');
  }
} //end of streamWeb_handler(req, res)

function adminWeb_handler(req, res) {
  if (req.url.length > 4096 || req.method !== 'GET' || req.url === '/favicon.ico') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, urlExt = Path.extname(urlPath), dev = q.device && devMgr[q.device];
  res.__logReq = cfg.logAllHttpRequests || !(urlExt === '.html' || urlExt === '.js' || urlExt === '.css' || urlPath === '/' || urlPath === '/status' || urlPath === '/getServerLog' || urlPath === '/getDeviceLog' || urlPath === '/GetDeviceCpuMemTop');
  res.__logReq && log((res.__tag = '[' + cfg.adminWeb_protocol.toUpperCase() + '_' + (res.seq = ++httpSeq) + ']') + ' ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (cfg.logHttpReqDetail ? ' [from ' + req.connection.remoteAddress + ':' + req.connection.remotePort + ']' : ''));
  if (urlExt === '.js' || urlExt === '.css') {
    return end(res, htmlCache[urlPath], urlExt === '.css' ? 'text/css' : urlExt === '.js' ? 'text/javascript' : '');
  }
  if (cfg.adminKey && q.adminKey !== cfg.adminKey) {
    return end(res, htmlCache['/login.html'], 'text/html');
  }
  setDefaultHttpHeaderAndInitCloseHandler(res);

  switch (urlPath) {
    case '/deviceControl': //--------------------------startRecording, stopRecording, stopLiveView', setAccessKey-------
      if (!dev && (chk.err = '`device`: unknown device')
          || !chk('action', q.action, ['startRecording', 'stopRecording', 'stopLiveView', 'setAccessKey'])
          || q.action === 'startRecording' && !chkCaptureParameter(q, /*force_ajpg:*/true)
          || q.orientation && !chk('orientation', q.orientation, ['landscape', 'portrait', 'free'])) {
        return end(res, chk.err);
      }
      q.accessKey = q.accessKey === undefined ? dev.accessKey : (q.accessKey || newAutoAccessKeyIfStreamWebPublic());
      dev.liveStreamer && forEachValueIn(dev.liveStreamer.consumerMap, function (res) {
        (q.action === 'stopRecording' && res.__tag === REC_TAG || q.action === 'startRecording' && (q._FpsScaleRotate !== dev.liveStreamer.q._FpsScaleRotate || res.__tag === REC_TAG) || q.action === 'stopLiveView' && res.__tag !== REC_TAG || q.accessKey !== dev.accessKey)
        && endCaptureConsumer(res, 'stop on demand' /*do not change this string*/);
      });
      q.accessKey !== dev.accessKey && (dev.accessKeyTimestamp = stringifyTimestampShort(getTimestamp()));
      q.accessKey !== dev.accessKey && scheduleUpdateWholeUI();
      q.accessKey !== dev.accessKey && (dev.accessKey = q.accessKey);
      q.orientation && setDeviceOrientation(dev, q.orientation);
      return end(res, q.action === 'startRecording' ? startRecording(q) : 'OK');
    case '/getDeviceLog':  //-----------------------------------get internal log file------------------------------------
      return spawn('[getDeviceLog]', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', 'cat', cfg.androidLogPath, '2>', '/dev/null'), function/*on_close*/(ret, stdout, stderr) {
        end(res, stdout || stringifyError(stderr) || (ret !== 0 ? 'unknown error' : ''), 'text/plain');
      }, {noLogStdout: true, noDetailLog: !cfg.logAllAdbCommands});
    case '/GetDeviceCpuMemTop':  //-----------------------------get device cpu memory usage -----------------------------
      return spawn('[GetDeviceCpuMemTop]', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', cfg.androidWorkDir + '/busybox', 'top', '-b', '-n', '1', '2>/dev/null', '||', 'top', '-n', '1', '-d', '0'), function/*on_close*/(ret, stdout, stderr) {
        end(res, stdout || stringifyError(stderr) || (ret !== 0 ? 'unknown error' : ''), 'text/plain');
      }, {noLogStdout: true, noDetailLog: !cfg.logAllAdbCommands});
    case '/': //---------------------------------------show menu of all devices---------------------------------------
      q.fps = q.fps === undefined ? String(cfg.defaultFps) : q.fps;
      q.scale = q.scale === undefined ? String(cfg.defaultScale) : q.scale;
      q.device = undefined;
      if (!chkCaptureParameter(q, /*force_ajpg:*/true)) {
        return end(res, chk.err);
      }
      return scanAllDevices(/*mode:*/'checkPrepare', function/*on_gotAllRealDev*/(realDeviceList) {
        var result_streamWebBaseURL = cfg.streamWebBaseURL || (cfg.streamWeb_protocol + '://' + (isAnyIp(cfg.streamWeb_ip) && getFirstPublicIp() || 'localhost') + ':' + cfg.streamWeb_port + '/');
        var html = htmlCache['/home.html']
                .replace(/@adminKey\b/g, querystring.escape(cfg.adminKey)).replace(/#adminKey\b/g, htmlEncode(cfg.adminKey))
                .replace(/@fps\b/g, q.fps).replace(/@scale\b/g, q.scale).replace(/@rotate\b/g, q.rotate)
                .replace(new RegExp('_selectedIf_rotate_' + (q.rotate || '0'), 'g'), 'selected')
                .replace(/@stream_web\b/g, result_streamWebBaseURL.replace(/\/$/, '')) //remove last slash
                .replace(/@result_streamWebBaseURL\b/g, result_streamWebBaseURL)
                .replace(/#localStreamWebBaseURL\b/g, (cfg.streamWeb_protocol + '://localhost:' + cfg.streamWeb_port + '/'))
                .replace(/_checkedIf_autoChooseStreamWebBaseURL\b/g, cfg.streamWebBaseURL ? '' : 'checked')
                .replace(/@hideIf_autoChooseStreamWebBaseURL\b/g, cfg.streamWebBaseURL ? '' : 'display:none')
                .replace(/@hideIf_no_local_ffmpeg\b/g, ffmpegOK ? '' : 'display:none')
                .replace(/@hideIf_local_ffmpeg\b/g, ffmpegOK ? 'display:none' : '')
                .replace(/@appVer\b/g, status.appVer)
                .replace(/_showIf_local_ffmpeg\b/g, ffmpegOK ? '' : 'style="display:none"')
                .replace(/@discover_from_ip\b/g, '*.*.*.' + cfg.discover_from_ip_part4)
            ;
        ['minFps', 'maxFps', 'streamWebBaseURL', 'discover_to_ip_part4', 'discover_to_ip_part4', 'discover_port', 'discover_maxFound', 'discover_totalTimeout', 'discover_timeout'].forEach(function (k) {
          html = html.replace(new RegExp('@' + k + '\\b', 'g'), cfg[k]);
        });
        dynamicConfKeyList.forEach(function (k) { //set enable or disable of some config buttons for /var? command
          html = html.replace(new RegExp('@' + k + '_negVal', 'g'), (cfg[k] ? 'false' : 'true')).replace(new RegExp('#' + k + '_negBtn', 'g'), (cfg[k] ? 'Disable' : 'Enable'));
        });
        cfg.adminKey && res.setHeader('Set-Cookie', 'adminKey=' + querystring.escape(cfg.adminKey) + '; HttpOnly');
        return end(res, html.replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
          return Object.keys(devMgr).sort().reduce(function (joinedStr, device) {
            return joinedStr + (cfg.showDisconnectedDevices || realDeviceList.indexOf(device) >= 0 ?
                replaceCommonDeviceVarInHtml(htmlBlock, (dev = devMgr[device]))
                    .replace(/#accessKeyTimestamp\b/g, htmlEncode(dev.accessKeyTimestamp))
                    .replace(/#devInfo\b/g, htmlEncode(dev.info))
                    .replace(/#devStatus\b/g, htmlEncode(dev.status))
                : '');
          }, ''/*initial joinedStr*/);
        }), 'text/html');
      });
    case '/stopServer':  //------------------------------------stop server management---------------------------------
      end(res, 'OK');
      adminWeb.close();
      streamWeb.close();
      Object.keys(childProcMap).forEach(function (pid) {
        childProcMap[pid].kill('SIGKILL');
      });
      return process.exit(0);
    case '/reloadResource':  //-----------------------------reload resource file to cache-----------------------------
      loadResourceSync();
      return end(res, 'OK');
    case '/set':
      if (q[q._confKey = 'streamWebBaseURL'] !== undefined) {
        if (q.streamWebBaseURL && ((parsedUrl = Url.parse(q.streamWebBaseURL)).protocol !== 'https:' && parsedUrl.protocol !== 'http:' || !parsedUrl.hostname || parsedUrl.search || parsedUrl.hash)) {
          return end(res, '`streamWebBaseURL`: must be an valid http or https URL, and must not contains querystring or #anchor');
        }
        q.streamWebBaseURL && (q.streamWebBaseURL = parsedUrl.format()); //always contains tail slash
      } else { //-------------------------------------------------Set some internal bool var--------------------------
        q._confKey = forEachValueIn(dynamicConfKeyList, function (k) {
          q[k] !== undefined && (q._confKey = k) && (q[k] = (q[k] === 'true'));
          return (q[k] !== undefined) && 'break';
        }) ? q._confKey : '';
      }
      if (q._confKey && cfg[q._confKey] !== q[q._confKey]) {
        cfg[q._confKey] = q[q._confKey];
        scheduleUpdateWholeUI();
      }
      return end(res, 'OK');
    case '/status':  //-----------------------------------push live capture status to browser-------------------------
      res.__previousVer = q.ver;
      res.__previousAppVer = q.appVer;
      status.consumerMap[res.__tag] = res;
      res.on('close', function () { //closed by http peer
        delete status.consumerMap[res.__tag];
      });
      return scheduleUpdateLiveUI();
    case '/getServerLog':  //------------------------------get server log---------------------------------------------
      q._logFilePath = log.getLogFilePath(q.logHowManyDaysAgo);
      if (q.mode && !chk('size', q.size = Number(q.size), 1, Number.MAX_VALUE) || q.mode === 'tail' && !(q._fileSize = getFileSizeSync(q._logFilePath))) {
        return end(res, chk.err);
      }
      q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + Path.basename(q._logFilePath)); //remove dir part
      return fs.createReadStream(q._logFilePath, q.mode ? {start: q.mode === 'tail' ? q._fileSize - q.size : 0, end: q.mode === 'tail' ? q._fileSize - 1 : q.size - 1} : null)
          .on('error',function (err) {
            end(res, stringifyError(err));
          }).pipe(res);
    case '/prepareAllDevices':  //-----------------------prepare device file/touchInfo/apk forcibly ------------------
      scanAllDevices(/*mode:*/'forcePrepare');
      return end(res, 'OK');
    case '/discover':
      if (!chk('from', q.from) || !chk('to', q.to_ip_part4 = Number(q.to), 1, 254) || !chk('port', q.port = Number(q.port), 1024, 65535) || !chk('maxFound', q.maxFound = Number(q.maxFound), 1, 254) || !chk('timeout', (q.timeout = Number(q.timeout) || 0), 0.1, 99) || !chk('totalTimeout', (q.totalTimeout = Number(q.totalTimeout) || 0), 0.1, 99)) {
        return end(res, chk.err);
      }
      if (!(q.parts = q.from.match(/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-4]|2[0-4][0-9]|[1-9][0-9]?[0-9]?|0[1-9][0-9]?)$/) || q.from.match(/^(\*)\.(\*)\.(\*)\.(25[0-4]|2[0-4][0-9]|[1-9][0-9]?[0-9]?|0[1-9][0-9]?)$/))) {
        return end(res, '`from`: must be an IPv4 address or *.*.*.<number> where <number> means a number');
      }
      if ((q.from_ip_part4 = Number(q.parts[4])) > q.to_ip_part4) {
        return end(res, '`from`: last part must be <= `to`');
      }
      ['from_ip_part4', 'to_ip_part4', 'port', 'maxFound', 'timeout', 'totalTimeout'].forEach(function (k) {
        (cfg['discover_' + k] !== q[k]) && (cfg['discover_' + k] = q[k]) !== undefined && scheduleUpdateWholeUI();
      });
      return end(res, discoverDevices(q.from.replace(/\.\d+$/, '')) || 'OK');
    case '/stopDiscover':
      discoverDevices.__tag && stopDiscover();
      return end(res, 'OK');
    default:
      return end(res, 'bad request');
  }
} //end of adminWeb_handler

function discoverDevices(ipSeg123) {
  var myIp = '', myIpSeg123 = '', niMap = os.networkInterfaces();
  if (!Object.keys(niMap).some(function (name) {
    return niMap[name].some(function (addr) {
      return !addr['internal'] && addr['family'] === 'IPv4' && (myIp = addr.address) && (myIpSeg123 = addr.address.replace(/\.\d+$/, '')) && (ipSeg123 === '*.*.*' || ipSeg123 === myIpSeg123);
    });
  })) {
    return myIp ? '`from`: the ip range is not matched with any active IPv4 network interface' : 'error: IPv4 network is not available';
  }
  discoverDevices.__tag && stopDiscover();
  discoverDevices.__timeoutTimer = setTimeout(stopDiscover, cfg.discover_totalTimeout * 1000);
  var tag = discoverDevices.__tag = '[Discover' + getTimestamp() + ']';
  var ipSeg4 = cfg.discover_from_ip_part4 - 1, ok_count = 0;
  return (function discoverNextDevice() {
    if (tag === discoverDevices.__tag) {
      (myIpSeg123 + '.' + (++ipSeg4)) === myIp && ++ipSeg4;
      if (ipSeg4 > cfg.discover_to_ip_part4 || ok_count >= cfg.discover_maxFound) {
        clearTimeout(discoverDevices.__timeoutTimer);
        discoverDevices.__tag = status.discoveringIp = discoverDevices.__childProc = discoverDevices.__timeoutTimer = null;
      } else {
        var device = (status.discoveringIp = myIpSeg123 + '.' + ipSeg4) + ':' + cfg.discover_port;
        discoverDevices.__childProc = spawn(tag, cfg.adb, ['connect', device], function/*on_close*/(ret, stdout) {
          if (stdout.slice(0, 9) === 'connected') {
            ok_count++;
            prepareDeviceFile(getOrCreateDevCtx(device));
          }
          discoverNextDevice();
        }, {timeout: cfg.discover_timeout * 1000, noDetailLog: !cfg.logAllAdbCommands});
      }
      scheduleUpdateLiveUI();
    }
  })();
}
function stopDiscover() {
  discoverDevices.__childProc.kill('SIGKILL');
  clearTimeout(discoverDevices.__timeoutTimer);
  discoverDevices.__tag = status.discoveringIp = discoverDevices.__childProc = discoverDevices.__timeoutTimer = null;
  scheduleUpdateLiveUI();
}

function loadResourceSync() {
  scheduleUpdateWholeUI();
  fs.readdirSync('./html').forEach(function (filename) {
    htmlCache['/' + filename] = fs.readFileSync('./html/' + filename).toString();
  });
  fs.readdirSync(cfg.outputDir).forEach(function (filename) {
    (filename = new FilenameInfo(filename)).isValid && getOrCreateDevCtx(filename.device);
  });
  prepareDeviceFile.ver = fs.readdirSync('./android').sort().reduce(function (hash, filename) {
    return hash.update(filename.match(/^\./) ? '' : fs.readFileSync('./android/' + filename));
  }, crypto.createHash('md5')/*initial value*/).digest('hex');
}

loadResourceSync();
spawn('[CheckAdb]', cfg.adb, cfg.adbOption.length ? ['version'] : ['devices'], function/*on_close*/(ret) {
  if (ret !== 0) {
    log('Failed to check "Android Debug Bridge". Please install it from http://developer.android.com/tools/sdk/tools-notes.html and add adb\'s dir into PATH env var or set full path of ffmpeg to "adb" in config.json or your own config file', {stderr: true});
    return process.exit(1);
  }
  return spawn('[CheckFfmpeg]', cfg.ffmpeg, ['-version'], function/*on_close*/(ret) {
    !(ffmpegOK = (ret === 0)) && log('Failed to check FFMPEG (for this machine, not for Android device). You can record video in H264/MP4 or WebM format. Please install it from http://www.ffmpeg.org/download.html and add the ffmpeg\'s dir to PATH env var or set full path of ffmpeg to "ffmpeg" in config.json or your own config file', {stderr: true});
    adminWeb = cfg.adminWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync('./ssl/adminWeb.pfx')}, adminWeb_handler) : require('http').createServer(adminWeb_handler);
    adminWeb.listen(cfg.adminWeb_port, isAnyIp(cfg.adminWeb_ip) ? undefined : isLocalOnlyIP(cfg.adminWeb_ip) ? '127.0.0.1' : cfg.adminWeb_ip, function/*on_httpServerReady*/() {
      streamWeb = cfg.streamWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync('./ssl/streamWeb.pfx')}, streamWeb_handler) : require('http').createServer(streamWeb_handler);
      streamWeb.listen(cfg.streamWeb_port, isAnyIp(cfg.streamWeb_ip) ? undefined : isLocalOnlyIP(cfg.streamWeb_ip) ? '127.0.0.1' : cfg.streamWeb_ip, function/*on_httpServerReady*/() {
        log('OK. You can start from ' + cfg.adminWeb_protocol + '://' + (isAnyIp(cfg.adminWeb_ip) ? 'localhost' : cfg.adminWeb_ip) + ':' + cfg.adminWeb_port + '/' + (cfg.adminKey ? '?adminKey=' + querystring.escape(cfg.adminKey) : ''), {stderr: true});
      });
    });
    setInterval(scanAllDevices, cfg.adbDeviceListUpdateInterval * 1000 + 50);
  }, {timeout: 10 * 1000});
}, {timeout: 30 * 1000});
