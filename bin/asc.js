'use strict';
var old_work_dir = process.cwd();
process.chdir(__dirname); //set dir of current file as working dir
var child_process = require('child_process'), fs = require('fs'), Url = require('url'), querystring = require('querystring'), Path = require('path'), crypto = require('crypto'), util = require('util'),
    jsonFile = require('./node_modules/jsonFile.js'), logger = require('./node_modules/logger.js'),
    cfg = util._extend(jsonFile.parse('./config.json'), process.argv[2/*first param*/] && jsonFile.parse(Path.resolve(old_work_dir, process.argv[2]))), //combine user provided configuration file with base file
    log = logger.create(cfg && cfg.log_filePath, cfg && cfg.log_keepOldFileDays);
log('===================================pid:' + process.pid + '=======================================\nuse configuration: ' + JSON.stringify(cfg, null, '  '));
process.on('uncaughtException', function (err) {
  log('uncaughtException: ' + err + "\n" + err.stack, {stderr: true});
  throw err;
});
var adminWeb, streamWeb, ffmpegOK, httpSeq = 0, devMgr = {/*deviceSN:*/}, status = {consumerMap: {/*consumerId:*/}}, htmlCache = {/*'/'+filename:*/}, childProcMap = {/*pid:*/};
var CrLfBoundTypeCrLf2 = new Buffer('\r\n--MULTIPART_BOUNDARY\r\nContent-Type: image/jpeg\r\n\r\n');
var ERR_DEV_NOT_FOUND = 'error: device not found', REC_TAG = '[REC]', CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = new Buffer([CR]), EMPTY_BUF = new Buffer([]);
var re_filename = /^(([^\/\\]+)~(?:live|rec)_[fF]\d+[^_]*_(\d{14}\.\d{3}(?:\.[A-Z]?\d+)?)(?:\.ajpg)?)(?:(?:\.(mp4))|(?:~frame([A-Z]?\d+)\.(jpg)))$/,
    re_size = /^0{0,3}([1-9][0-9]{0,3})x0{0,3}([1-9][0-9]{0,3})$|^0{0,3}([1-9][0-9]{0,3})x(?:Auto)?$|^(?:Auto)?x0{0,3}([1-9][0-9]{0,3})$/i,
    re_httpRange = /^bytes=(\d*)-(\d*)$/i, re_adminKey_cookie = /adminKey=([^;]+)/, re_repeatableHtmlBlock = /<!--repeatBegin-->\s*([^\0]*)\s*<!--repeatEnd-->/g;
var switchList = ['showDisconnectedDevices', 'logFfmpegDebugInfo', 'logFpsStatistic', 'logHttpReqDetail', 'logAllAdbCommands', 'logAllHttpReqRes', 'fastResize', 'fastCapture'];
true === false && log({log_filePath: 0, log_keepOldFileDays: 0, adb: 0, adbOption: 0, ffmpeg: 0, binDir: 0, androidWorkDir: 0, androidLogPath: 0, streamWeb_ip: 0, streamWeb_port: 0, streamWeb_protocol: 0, streamWeb_cert: 0, adminWeb_ip: 0, adminWeb_port: 0, adminWeb_protocol: 0, adminWeb_cert: 0, outputDir: 0, enableGetOutputFile: 0, maxRecordTime: 0, logHowManyDaysAgo: 0, download: 0, adbGetDeviceListTimeout: 0, adbDeviceListUpdateInterval: 0, adbKeepDeviceAliveInterval: 0, stack: 0, logFfmpegDebugInfo: 0, logFpsStatistic: 0, logHttpReqDetail: 0, showDisconnectedDevices: 0, logAllAdbCommands: 0, adbEchoTimeout: 0, adbFinishPrepareFileTimeout: 0, adbPushFileToDeviceTimeout: 0, adbCheckDeviceTimeout: 0, adbCaptureExitDelayTime: 0, adbSendKeyTimeout: 0, adbSetOrientationTimeout: 0, adbCmdTimeout: 0, adbTurnScreenOnTimeout: 0, fpsStatisticInterval: 0, logAllHttpReqRes: 0, resentUnchangedImageInterval: 0, resentImageForSafariAfter: 0, adminUrlSuffix: 0, viewUrlBase: 0, __end: 0});

function spawn(tag, _path, args, _on_close, _opt) {
  var on_close = (typeof(_on_close) === 'function') && _on_close, opt = !on_close && _on_close || _opt || {}, childProc, stdoutBufAry = [], stderrBufAry = [], logHead2;
  opt.stdio = opt.stdio || ['ignore'/*stdin*/, 'pipe'/*stdout*/, 'pipe'/*stderr*/];
  opt.log && log(tag + ' spawn \"' + _path + '\" with args: ' + JSON.stringify(args));

  childProc = child_process.spawn(_path, args, opt);
  childProc.__tag = tag = tag + (childProc.pid ? '[pid_' + childProc.pid + ']' : '');
  opt.log && log(tag + (childProc.pid ? ' spawned' : ' not spawned'));
  childProc.pid && (childProcMap[childProc.pid] = childProc);

  childProc.stdout && (on_close && !opt.noMergeStdout || opt.log && !opt.noLogStdout) && childProc.stdout.on('data', function (buf) {
    stdoutBufAry.push(buf);
  });
  childProc.stderr && childProc.stderr.on('data', function (buf) {
    on_close && !opt.noMergeStderr && stderrBufAry.push(buf);
    log(buf, {noNewLine: true, head: (logHead2 = logHead2 || tag + '2>')});
  });
  opt.timeout && (childProc.__timeoutTimer = setTimeout(function () {
    childProc.__err = 'error: timeout';
    opt.log && log(tag + ' kill due to timeout(' + opt.timeout + 'ms)');
    childProc.kill('SIGKILL');
  }, opt.timeout));

  childProc.on('error', function (err) {
    (childProc.__err = stringifyError(err)) === 'Error: spawn OK' ? (childProc.__err = '') : (opt.log && log(tag + ' ' + childProc.__err));
  });
  childProc.on('close', function (ret, signal) { //exited or failed to spawn
    childProc.pid && delete childProcMap[childProc.pid];
    clearTimeout(childProc.__timeoutTimer);
    !childProc.__err && signal && (childProc.__err = 'error: killed by ' + signal);
    var stderr = childProc.__err || Buffer.concat(stderrBufAry).toString(), stdout = Buffer.concat(stdoutBufAry).toString();
    stdoutBufAry.length = stderrBufAry.length = 0;
    opt.log && !opt.noLogStdout && stdout && log(stdout, {noNewLine: true, head: tag + '>'});
    opt.log && log(tag + ' exited:' + (ret === null || ret === undefined ? '' : (' ' + ret)) + (signal ? (' ' + signal) : ''));
    on_close && on_close(ret, stdout, stderr);
  });
  childProc.stdin && childProc.stdin.on('error', function (err) {
    !childProc.stdin.__isClosed && (childProc.stdin.__isClosed = true) && opt.log && log(tag + '[stdin] ' + err);
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

function forEachValueIn(mapOrArray, callback) {
  return Object.keys(mapOrArray).some(function (k) {
    return callback(mapOrArray[k], k, mapOrArray) === 'break';
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
  return !res.__isEnded && !res.__isClosed && res.write(buf);
}
function writeMultipartImage(res, buf, doNotCount) { //Note: this will write next content-type earlier to force Chrome draw image immediately
  return !res.__isEnded && !res.__isClosed && (doNotCount || (res.__framesWritten = (res.__framesWritten || 0) + 1)) && res.write(Buffer.concat([res.headersSent ? EMPTY_BUF : CrLfBoundTypeCrLf2, buf, CrLfBoundTypeCrLf2]));
}
function end(res, textContent/*optional*/, type) {
  if (!res.__isEnded && !res.__isClosed) {
    res.__isEnded = true;
    if (textContent && res.setHeader && !res.headersSent) { //for unsent http response
      res.setHeader('Content-Type', type || 'text/plain');
      !type && res.removeHeader('Content-Length');
      !type && res.removeHeader('Content-Disposition'); //remove download flag
    }
    res.__log && log(res.__tag + ' END' + (textContent && !type ? ': ' + textContent : ''));
    res.end(textContent);
  }
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

function FilenameInfo(f, device) {
  (this.name = f) && (f = f.match(re_filename)) && (this.device = querystring.unescape(f[2])) && (!device || this.device === device) && (this.src = f[1]) && (this.timestamp = f[3]) && (this.type = f[4] || f[6]) && (f[4]/*isVideo*/ || (this.i = f[5]) !== '') && (this.isValid = true);
}
FilenameInfo.prototype.toString = function () {
  return this.name /*in fact is original name*/;
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
  return devMgr[device] || (devMgr[device] = {device: device, info: [], info_disp: '', status: '', touchStatus: '', touch: {}, consumerMap: {}, masterMode: false, accessKey: newAutoAccessKey().replace(/^.{10}/, '----------'), subOutputDir: '', recordingFileTimestampSet: {}});
}
function newAutoAccessKey() {
  return !cfg.adminKey ? '' : (getTimestamp().slice(4, 14) + '_' + crypto.createHash('md5').update(cfg.adminKey + Date.now() + Math.random()).digest('hex'));
}

function scanAllDevices(mode/* 'checkPrepare', 'forcePrepare', 'doNotRepairDeviceFile', undefined means repeatScanInBackground */, on_gotAllRealDev) {
  if (scanAllDevices.waiters) {
    return on_gotAllRealDev && scanAllDevices.waiters.push(on_gotAllRealDev);
  }
  scanAllDevices.waiters = on_gotAllRealDev ? [on_gotAllRealDev] : [];
  return spawn('[GetAllDevices]', cfg.adb, cfg.adbOption.concat('devices'), function/*on_close*/(ret, stdout) {
    var deviceList = [], parts;
    if (ret === 0) {
      stdout.split('\n').slice(1/*from second line*/).forEach(function (lineStr) {
        if ((parts = lineStr.split('\t')).length > 1) {
          var device = parts[0], _status = parts[1];
          if (/[^?]/.test(device) && deviceList.indexOf(device) < 0) { //exclude SN such as ??????
            deviceList.push(device);
            var dev = getOrCreateDevCtx(device);
            (dev.status === ERR_DEV_NOT_FOUND || !dev.status) && log('[GetAllDevices] device connected: ' + device);
            dev.status === ERR_DEV_NOT_FOUND && scheduleUpdateWholeUI();
            dev.status === ERR_DEV_NOT_FOUND && (dev.status = dev.touchStatus = '');
            (mode === 'forcePrepare' || mode === 'checkPrepare' || !dev.status || dev._status !== _status || dev.isOsStartingUp) && prepareDeviceFile(dev, mode === 'forcePrepare');
            dev._status = _status;
          }
        }
      });
    }
    forEachValueIn(devMgr, function (dev) {
      if (deviceList.indexOf(dev.device) < 0 && dev.status !== ERR_DEV_NOT_FOUND) {
        dev.status && log('[GetAllDevices] device disconnected: ' + dev.device);
        dev.status = ERR_DEV_NOT_FOUND;
        scheduleUpdateWholeUI();
      }
    });
    scanAllDevices.waiters.forEach(function (callback) {
      callback(deviceList);
    });
    scanAllDevices.waiters = null;
    !mode && deviceList.forEach(function (device) {
      if (devMgr[device].status === 'OK' && Date.now() - (devMgr[device].lastKeepAliveDateMs || 0) >= cfg.adbKeepDeviceAliveInterval * 1000) {
        devMgr[device].lastKeepAliveDateMs = Date.now();
        spawn('[KeepAlive]', cfg.adb, cfg.adbOption.concat('-s', device, 'shell', 'a='), {timeout: cfg.adbEchoTimeout * 1000, log: cfg.logAllAdbCommands});
      }
    });
  }, {timeout: cfg.adbGetDeviceListTimeout * 1000, log: cfg.logAllAdbCommands}); //end of GetAllDevices
}

var cmd_getBaseInfo = ['getprop', 'ro.product.manufacturer;', 'getprop', 'ro.product.model;', 'getprop', 'ro.build.version.release;', 'getprop', 'ro.product.cpu.abi;',
  'echo', '===;', 'getevent', '-pS;', //get touch device info
  'echo', '===;', 'cd', cfg.androidWorkDir, '&&', 'cat', 'version', '||', 'exit;'];
var cmd_getExtraInfo = ['echo', '===;', 'umask', '077;', 'export', 'LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.;',
  'echo', '===;', 'dumpsys', 'window', 'policy', '|', './busybox', 'grep', '-E', '\'mUnrestrictedScreen=|DisplayWidth=\';',
  'echo', '===;', './busybox', 'grep', '-Ec', '\'^processor\'', '/proc/cpuinfo;',
  'echo', '===;', './busybox', 'head', '-n', '1', '/proc/meminfo;',
  '{', 'echo', '===;', './dlopen', './sc-???', '||', './dlopen.pie', './sc-???;',
  'echo', '===;', './dlopen', './fsc-???', '||', './dlopen.pie', './fsc-???;', '}', '2>', cfg.androidLogPath, ';'];
function prepareDeviceFile(dev, force/*optional*/) {
  if (!(dev.status === 'OK' && !force || dev.status === 'preparing')) {
    log('[PrepareDeviceFile for ' + dev.device + '] begin');
    dev.status !== 'preparing' && (dev.status = 'preparing') && scheduleUpdateWholeUI();
    var on_complete = function (status) {
      log('[PrepareFileToDevice ' + dev.device + '] ' + status);
      dev.status !== status && (dev.status = status) && scheduleUpdateWholeUI();
    };
    spawn('[CheckDevice ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', [].concat(cmd_getBaseInfo, cmd_getExtraInfo).join(' ')), function/*on_close*/(ret, stdout, stderr) {
      if (ret !== 0) {
        return on_complete(stringifyError(stderr) || 'unknown error: failed to check device');
      }
      var parts = stdout.trim().split(/\s*===\s*/);
      if (parts.length !== 3 && parts.length !== 9) {
        return on_complete('unknown error: failed to check device');
      }
      dev.CrCount = Math.max(0, stdout.match(/\r?\r?\n$/)[0].length - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/); //in unix/linux this will be 0
      dev.info = parts[0].split(/\r*\n/);
      dev.sysVer = (dev.info[2] + '.0.0').split('.').slice(0, 3).join('.'); // 4.2 -> 4.2.0
      dev.armv = parseInt(dev.info[3].replace(/^armeabi-v|^arm64-v/, '')) >= 7 ? 7 : 5; //armeabi-v7a -> 7
      dev.info[3] = (dev.info[3] = dev.info[3].replace(/^armeabi-|^arm64-/, '')) == 'v7a' ? '' : dev.info[3];
      getTouchDeviceInfo(dev, parts[1]);
      dev.info_disp = htmlEncode(dev.info.join(' ') + (dev.cpuCount === undefined ? '' : ' ' + dev.cpuCount + 'c') + (dev.memSize === undefined ? '' : ' ' + (dev.memSize / 1000).toFixed() + 'm') + (!dev.disp ? '' : ' ' + dev.disp.w + 'x' + dev.disp.h));
      if (parts.length === 9 && getMoreInfo(dev, parts.slice(3)) && parts[2] === prepareDeviceFile.ver && !force) {
        return on_complete('OK');
      }
      return spawn('[PushFileToDevice ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'push', cfg.binDir, cfg.androidWorkDir), function/*on_close*/(ret, stdout, stderr) {
        if (ret !== 0) {
          return on_complete(stringifyError(stderr.replace(/push: .*|\d+ files pushed.*|.*KB\/s.*/g, '')) || 'unknown error: failed to push file to device');
        }
        return spawn('[FinishPrepareFile ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', [].concat('cd', cfg.androidWorkDir, '&&', 'chmod', '700', '.', '*', '&&', 'umask', '077', '&&', 'echo', prepareDeviceFile.ver, '>', 'version;', cmd_getExtraInfo).join(' ')), function/*on_close*/(ret, stdout, stderr) {
          if (ret !== 0) {
            return on_complete(stringifyError(stderr) || 'unknown error: failed to finish preparing device file');
          }
          var parts = stdout.trim().split(/\s*===\s*/);
          if (parts.length !== 7) {
            return on_complete('unknown error: failed to finish preparing device file');
          } else if (parts[0]) {
            return on_complete(stringifyError(parts[0]));
          } else if (!getMoreInfo(dev, parts.slice(1))) {
            return on_complete('unknown error: failed to ' + (!dev.libPath ? 'check internal lib' : !dev.disp ? 'check display size' : '?'));
          }
          setDeviceOrientation(dev, 'free');
          return on_complete('OK');
        }, {timeout: cfg.adbFinishPrepareFileTimeout * 1000, log: true}); //end of FinishPrepareFile
      }, {timeout: cfg.adbPushFileToDeviceTimeout * 1000, log: true}); //end of PushFileToDevice
    }, {timeout: cfg.adbCheckDeviceTimeout * 1000, log: true}); //end of CheckDevice
  }
}
function getMoreInfo(dev, ary/*result of cmd_getExtraInfo*/) {
  dev.isOsStartingUp = (ary[1] === "Can't find service: window");
  (ary[1] = ary[1].match(/([1-9]\d\d+)\D+([1-9]\d\d+)/)) && (dev.disp = {w: Math.min(ary[1][1], ary[1][2]), h: Math.max(ary[1][1], ary[1][2])}) && [1, 2, 4, 5, 6, 7].forEach(function (i) {
    dev.disp[i] = {w: Math.ceil(dev.disp.w * i / 8 / 2) * 2, h: Math.ceil(dev.disp.h * i / 8 / 2) * 2};
  });
  dev.cpuCount = Number(ary[2]) || 1;
  (ary[3] = ary[3].match(/\d+/)) && (dev.memSize = Number(ary[3][0]));
  dev.libPath = ary[4].split(/\r*\n/).sort().pop();
  dev.fastLibPath = ary[5].split(/\r*\n/).sort().pop();
  dev.info_disp = htmlEncode(dev.info.join(' ') + (dev.cpuCount === undefined ? '' : ' ' + dev.cpuCount + 'c') + (dev.memSize === undefined ? '' : ' ' + (dev.memSize / 1000).toFixed() + 'm') + (!dev.disp ? '' : ' ' + dev.disp.w + 'x' + dev.disp.h));
  return dev.libPath && dev.disp;
}
function getTouchDeviceInfo(dev, stdout) {
  dev.touchStatus = 'error: touch device not found' /*do not change this string*/;  //almost impossible
  dev.touch.modernStyle = stdout.indexOf('INPUT_PROP_DIRECT') >= 0;
  stdout.split(/add device \d+: /).some(function (devInfo) {
    var match = {};
    if ((match['0035'] = devInfo.match(/\D*0035.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_X*/ && (match['0036'] = devInfo.match(/\D*0036.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_Y*/) {
      if ((dev.touch.modernStyle && devInfo.indexOf('INPUT_PROP_DIRECT') >= 0) || (!dev.touch.modernStyle && !devInfo.match(/\n +name: +.*pen/))) {
        dev.touch.w = Math.floor((Number(match['0035'][1]) + 1) / 2) * 2;
        dev.touch.h = Math.floor((Number(match['0036'][1]) + 1) / 2) * 2;
        if (!dev.touch.w || !dev.touch.h) {
          log('[GetTouchDevInfo ' + dev.device + ']' + ' strange: max_x=' + match['0035'][1] + ' max_y=' + match['0036'][1]);
        } else {
          match['0030'] = devInfo.match(/\D*0030.*value.*min.*max\D*(\d+)/) || {1: 32}; //ABS_MT_TOUCH_MAJOR
          match['0039'] = devInfo.match(/\D*0039.*value.*min.*max\D*(\d+)/) || {1: 1}; //ABS_MT_TRACKING_ID
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
    }, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'pipe'/*stderr*/], log: true}));
    cmd && cfg.logAllAdbCommands && log(cmd, {head: '[Touch ' + dev.device + ']' + ' exec: '});
    cmd && dev.touchShell.stdin.write(cmd + '\n');

    if (q.type === 'd' || q.type === 'm') { //down, move
      dev.touchLast_x = x;
      dev.touchLast_y = y;
    }
  }
}
function setDeviceOrientation(dev, orientation) {
  spawn('[SetOrientation ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', 'cd ' + cfg.androidWorkDir + '; ls -d /data/data/jp.sji.sumatium.tool.screenorientation >/dev/null 2>&1 || (echo install ScreenOrientation.apk; pm install ./ScreenOrientation.apk 2>&1 | ./busybox grep -Eo \'^Success$|\\[INSTALL_FAILED_ALREADY_EXISTS\\]\') && am startservice -n jp.sji.sumatium.tool.screenorientation/.OrientationService -a ' + orientation + (dev.sysVer >= '4.2.2' ? ' --user 0' : '')), {timeout: cfg.adbSetOrientationTimeout * 1000, log: cfg.logAllAdbCommands});
}
function turnOnScreen(dev) {
  dev.sysVer > '2.3.0' && spawn('[TurnScreenOn ' + dev.device + ']', cfg.adb, cfg.adbOption.concat('-s', dev.device, 'shell', [].concat('dumpsys', 'power', '|', (dev.sysVer >= '4.2.2' ? 'grep' : [cfg.androidWorkDir + '/busybox', 'grep']), '-q', (dev.sysVer >= '4.2.2' ? 'mScreenOn=false' : 'mPowerState=0'), '&&', '(', 'input', 'keyevent', 26, ';', 'input', 'keyevent', 82, ')').join(' ')), {timeout: cfg.adbTurnScreenOnTimeout * 1000, log: cfg.logAllAdbCommands});
}

function chkCaptureParameter(dev, q, force_ajpg, forRecording) {
  q.fastResize === undefined && (q.fastResize = q['useFastResize']); //for compatibility
  q.fastCapture === undefined && (q.fastCapture = q['useFastCapture']); //for compatibility
  q.size === undefined && (q.size = q['scale']); //for compatibility
  q._old = {size: q.size, orient: q.orient, fastCapture: q.fastCapture, fastResize: q.fastResize};
  q._priority = (q.size || q.orient || q.fastCapture || q.fastResize) ? 1 : 0;
  if (dev && dev.status !== 'OK' && (chk.err = 'error: device not ready')
      || dev && !chk('type', q.type = force_ajpg ? 'ajpg' : q.type || 'ajpg', ['ajpg', 'jpg'])
      || ( !(q._psz = (q.size = q.size || cfg.viewSize).match(re_size)) && !((q._scaleFactor = Number(q.size)) >= 0.1 && q._scaleFactor <= 1) && (chk.err = '`size`: must be resize factor (>=0.1 <=1) or size patterns: Example: 400x600, 400x, x600 (600x400 means landscape)') )
      || !chk('orient', (q.orient = q.orient || cfg.viewOrient), ['portrait', 'landscape'])
      || !chk('fastResize', (q.fastResize = q.fastResize || String(cfg.fastResize)), ['true', 'false'])
      || !chk('fastCapture', (q.fastCapture = q.fastCapture || String(cfg.fastCapture)), ['true', 'false'])) {
    return false;
  }
  var w = q._psz ? Number(q._psz[1] || q._psz[3]) : 0, h = q._psz ? Number(q._psz[2] || q._psz[4]) : 0;
  (w && h) && (q.orient = (w > h) ? 'landscape' : 'portrait'); //adjust orientation if w > h

  if (dev) {
    //set q._psz = normalized portrait size. (keep q._psz.w < q._psz.h)  Note: dev.disp.w always < dev.disp.h
    q._psz = (w || h) ? {w: w && h ? Math.min(w, h) : w, h: w && h ? Math.max(w, h) : h} : {w: dev.disp.w * q._scaleFactor, h: dev.disp.h * q._scaleFactor};
    q._psz = {w: Math.min(dev.disp.w, Math.ceil((q._psz.w || q._psz.h * dev.disp.w / dev.disp.h) / 2) * 2), h: Math.min(dev.disp.h, Math.ceil((q._psz.h || q._psz.w * dev.disp.h / dev.disp.w) / 2) * 2)};

    q.fastResize = q.fastResize === 'true' && (!!dev.fastLibPath || dev.libPath >= './sc-400');
    q.fastCapture = q.fastCapture === 'true' && !!dev.fastLibPath;
    if (q.fastResize) { //resize image by hardware. Adjust q._psz to be n/8
      var r = Math.max(q._psz.w * 8 / dev.disp.w, q._psz.h * 8 / dev.disp.h);
      q._psz = r <= 1 ? dev.disp[1] : r <= 2 ? dev.disp[2] : r <= 4 ? dev.disp[4] : r <= 5 ? dev.disp[5] : r <= 6 ? dev.disp[6] : r <= 7 ? dev.disp[7] : dev.disp;
      q.fastResize = q._psz.w !== dev.disp.w || q._psz.h !== dev.disp.h;
    } else {
      var rr = Math.max(q._psz.w / dev.disp.w, q._psz.h / dev.disp.h);
      q._psz = {w: Math.min(dev.disp.w, Math.ceil((rr * dev.disp.w) / 2) * 2), h: Math.min(dev.disp.h, Math.ceil((rr * dev.disp.h) / 2) * 2)};
    }
    var landscape = (q.orient === 'landscape');
    w = landscape ? q._psz.h : q._psz.w; //adjust visibly requested w  (maybe > h)
    h = landscape ? q._psz.w : q._psz.h; //adjust visibly requested h  (maybe < w)
    q.size = w + 'x' + h; //adjust display string for size again

    if (q.fastResize) { //resize image by hardware
      if (q.fastCapture) {
        q._reqSz = {w: w, h: h}; //resize and rotate by hardware. Maybe w > h, means landscape
        q._filter = 'crop=' + w + ':' + h + ':0:0'; //crop excessive region allocated by hardware buffer
      } else {
        q._reqSz = q._psz; //resize by hardware, always portrait
        q._filter = landscape ? 'transpose=2' : ''; //rotate by software
      }
    } else { //get full size image first
      if (q.fastCapture) {
        q._reqSz = landscape ? {w: dev.disp.h, h: dev.disp.w} : null; //w > h means rotate by hardware
        q._filter = 'crop=' + (landscape ? dev.disp.h : dev.disp.w) + ':' + (landscape ? dev.disp.w : dev.disp.h) + ':0:0,scale=' + w + ':' + h; //resize by software, crop excessive region allocated by hardware buffer
      } else { //most poor mode,
        q._reqSz = null; //always get full size portrait image
        q._filter = 'scale=' + q._psz.w + ':' + q._psz.h + (landscape ? ',transpose=2' : ''); //resize, rotate by software
      }
    }
    q._hash = (q.fastCapture ? (q.fastResize ? 'F30' : 'F15') : q.fastResize ? 'f10' : 'f4') + (q._reqSz ? 'W' : 'w') + w + (q._reqSz ? 'H' : 'h') + h;
    q.timestamp = getTimestamp();
    q._disp = (q.fastCapture ? (q.fastResize ? 'F30' : 'F15') : q.fastResize ? 'f10' : 'f4') + ' ' + w + (q._reqSz ? 'X' : 'x') + h + ' ' + q.timestamp.slice(8, 10) + ':' + q.timestamp.slice(10, 12) + ':' + q.timestamp.slice(12, 14);

    if (dev.capture && q._hash !== dev.capture.q._hash && q._priority >= dev.capture.q._priority && !dev.masterMode && !forRecording)
      endCaptureProcess(dev); //stop incompatible capture process immediately if necessary
  }
  return true;
}
function _startNewCaptureProcess(dev, q) {
  var capture = dev.capture = {q: q}, bufAry = [], foundMark = false;
  var childProc = capture.__childProc = spawn('[CAP ' + q.device + ' ' + q._hash + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', [].concat(
          '{', 'date', '>&2', '&&', 'cd', cfg.androidWorkDir, '&&', 'export', 'LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.', (cfg.logFfmpegDebugInfo ? ['&&', 'export', 'ASC_LOG_ALL=1'] : []), '&&',
          './ffmpeg.armv' + dev.armv + (dev.sysVer >= '5.0.0' ? '.pie' : ''), '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
          '-f', 'androidgrab', '-probesize', 32/*min bytes for check*/, (q._reqSz ? ['-width', q._reqSz.w, '-height', q._reqSz.h] : []), '-i', q.fastCapture ? dev.fastLibPath : dev.libPath,
          (q._filter ? ['-vf', '\'' + q._filter + '\''] : []), '-f', 'mjpeg', '-q:v', '1', '-'/*output to stdout*/, ';',
          '}', '2>', cfg.androidLogPath).join(' ')
  ), function/*on_close*/() {
    capture === dev.capture && endCaptureProcess(dev);
  }, {noLogStdout: true, noMergeStdout: true, log: true});
  childProc.stdout.on('data', function (buf) {
    capture === dev.capture && convertCRLFToLF(capture/*context*/, dev.CrCount, buf).forEach(function (buf) {
      var pos = 0, unsavedStart = 0, endPos = buf.length;
      for (; pos < endPos; pos++) {
        if (foundMark && buf[pos] === 0xD9) {
          capture.image = {buf: Buffer.concat(bufAry.push(buf.slice(unsavedStart, pos + 1)) && bufAry), i: capture.image ? capture.image.i + 1 : 1};
          bufAry = [];
          unsavedStart = pos + 1;
          forEachValueIn(dev.consumerMap, function (res) {
            res.setHeader/*isHttp*/ && (res.q.type === 'ajpg' ? writeMultipartImage : endCaptureConsumer)(res, capture.image.buf);
          });//end of consumer enum
        }
        foundMark = (buf[pos] === 0xff);
      } //end of for loop in buffer
      unsavedStart < endPos && bufAry.push(buf.slice(unsavedStart, endPos));
    });
  });
  turnOnScreen(dev);
  scheduleUpdateLiveUI();
  q.fastCapture && (capture.timer_resentImageForSafari = setInterval(function () { //resend image once for safari to force display
    capture.image && (capture.image.i === capture.oldImageIndex ? forEachValueIn(dev.consumerMap, function (res) {
      res.q._isSafari && !res.__didResend && (res.__didResend = true) && writeMultipartImage(res, capture.image.buf, /*doNotCount:*/true);
    }) : (capture.oldImageIndex = capture.image.i));
  }, cfg.resentImageForSafariAfter * 1000));
  capture.timer_resentUnchangedImage = setInterval(function () {
    capture.image && (capture.image.i === capture.veryOldImageIndex ? forEachValueIn(dev.consumerMap, function (res) { //resend image to keep image tag alive
      writeMultipartImage(res, capture.image.buf, /*doNotCount:*/true);
    }) : (capture.veryOldImageIndex = capture.image.i));
  }, cfg.resentUnchangedImageInterval * 1000);
}
function doCapture(dev, res/*Any Type Output Stream*/, q) {
  !dev.capture && _startNewCaptureProcess(dev, q);
  dev.consumerMap[res.__tag] = res;
  scheduleUpdateLiveUI();
  clearTimeout(dev.capture.delayKillTimer);
  res.q = q;
  res.on('close', function () { //closed by http peer
    endCaptureConsumer(res);
  });
  res.setHeader && res.setHeader('Content-Type', q.type === 'ajpg' ? 'multipart/x-mixed-replace;boundary=MULTIPART_BOUNDARY' : 'image/jpeg');
  res.setHeader/*http*/ && q.type === 'ajpg' && (res.__statTimer = setInterval(function () {
    res.output.length >= 30 && !res.__didResend && (res.__framesDropped = 28) && (res.output.length = res.outputEncodings.length = res.output.length - res.__framesDropped);
    (cfg.logFpsStatistic || res.__framesDropped) && log(dev.capture.__childProc.__tag + res.__tag + ' statistics: Fps=' + ((res.__framesWritten || 0) / cfg.fpsStatisticInterval).toPrecision(3) + (res.__framesDropped ? ' dropped frames: ' + res.__framesDropped : ''));
    res.__framesWritten = res.__framesDropped = 0;
  }, cfg.fpsStatisticInterval * 1000));
  q.fastCapture && dev.capture.image && (res.setHeader && q.type === 'ajpg') && writeMultipartImage(res, dev.capture.image.buf);
  q.type === 'jpg' && dev.capture.image && endCaptureConsumer(res, dev.capture.image.buf);
  q.type === 'jpg' && dev.capture.image && dev.capture.q !== q && clearTimeout(status.updateLiveUITimer); //remove unnecessary update if not new capture process
}
function endCaptureConsumer(res/*Any Type Output Stream*/, imageBuf/*optional*/) {
  var dev = devMgr[res.q.device];
  if (dev.consumerMap[res.__tag] === res) {
    delete dev.consumerMap[res.__tag];
    scheduleUpdateLiveUI();
    imageBuf && write(res, imageBuf);
    end(res);
    clearTimeout(res.__recordTimer);
    clearInterval(res.__statTimer);
    clearInterval(res.__feedConvertTimer);
    !Object.keys(dev.consumerMap).length && (dev.capture.delayKillTimer = global.setTimeout(endCaptureProcess, cfg.adbCaptureExitDelayTime * 1000, dev));
  }
}
function endCaptureProcess(dev) {
  if (!dev.capture) return;
  forEachValueIn(dev.consumerMap, endCaptureConsumer);
  clearTimeout(dev.capture.delayKillTimer);
  clearInterval(dev.capture.timer_resentImageForSafari);
  clearInterval(dev.capture.timer_resentUnchangedImage);
  childProcMap[dev.capture.__childProc.pid] && dev.capture.__childProc.kill('SIGKILL');
  dev.capture = null;
  scheduleUpdateLiveUI();
}
function doRecord(dev, q/*same as capture*/) {
  var filename = querystring.escape(q.device) + '~rec_' + (dev.capture && dev.capture.q || q)._hash + '_' + q.timestamp + '.mp4', outPath = cfg.outputDir + '/' + dev.subOutputDir + '/' + filename;
  dev.recordingFileTimestampSet[q.timestamp] = true;
  var childProc = spawn('[REC ' + q.device + ' ' + (dev.capture && dev.capture.q || q)._hash + ']', cfg.ffmpeg, [].concat(
      '-y' /*overwrite output*/, '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
      '-f', 'mjpeg', '-r', cfg.videoFileFrameRate, '-i', '-'/*stdin*/,
      '-pix_fmt', 'yuv420p'/*for safari mp4*/, outPath
  ), function/*on_close*/() {
    dev.subOutputDir && fs.link(outPath, cfg.outputDir + '/' + filename, log.nonEmpty);
    delete dev.recordingFileTimestampSet[q.timestamp];
  }, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'pipe'/*stderr*/], log: true, noMergeStderr: true});
  childProc.stdin.__feedConvertTimer = setInterval(function () {
    dev.capture.image && write(childProc.stdin, dev.capture.image.buf);
  }, 1000 / cfg.videoFileFrameRate);
  childProc.stdin.__recordTimer = global.setTimeout(endCaptureConsumer, cfg.maxRecordTime * 1000, childProc.stdin);
  childProc.stdin.__tag = REC_TAG;
  doCapture(dev, childProc.stdin, q);
  return 'OK: ' + filename;
}

function scheduleUpdateLiveUI() {
  if (Object.keys(status.consumerMap).length) {
    clearTimeout(status.updateLiveUITimer);
    status.updateLiveUITimer = setTimeout(function () {
      var sd = {}, json;
      forEachValueIn(devMgr, function (dev) {
        if (dev.status !== ERR_DEV_NOT_FOUND || cfg.showDisconnectedDevices) {
          var id = htmlIdEncode(dev.device);
          var liveViewCount = Object.keys(dev.consumerMap).length - (dev.consumerMap[REC_TAG] ? 1 : 0);
          sd['liveViewCount_' + id] = liveViewCount ? '(' + liveViewCount + ')' : '';
          sd['recordingCount_' + id] = dev.consumerMap[REC_TAG] ? '(1)' : '';
          sd['captureParameter_' + id] = dev.capture ? dev.capture.q._disp : '';
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
    }, 0);
  }
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
    (res.__isClosed = true) && res.__log && log(res.__tag + ' CLOSED by peer');
  });
  res.on('finish', function () { //response stream have been flushed and ended without log, such as .pipe()
    res.__log && !res.__isEnded && log(res.__tag + ' END');
  });
  res.on('error', function (err) { //in fact, i'v never been here
    !res.__isClosed && (res.__isClosed = true) && res.__log && log(res.__tag + ' ' + err);
  });
}
function replaceComVar(html, dev) {
  return html.replace(/@device\b/g, querystring.escape(dev.device)).replace(/#device\b/g, htmlEncode(dev.device)).replace(/\$device\b/g, htmlIdEncode(dev.device))
      .replace(/@accessKey\b/g, querystring.escape(dev.accessKey.slice(11))).replace(/#accessKey\b/g, htmlEncode(dev.accessKey.slice(11))).replace(/#devInfo\b/g, dev.info_disp)
}
String.prototype.replaceShowIf = function (placeHolder, show) {
  return this.replace(new RegExp('@showIf_' + placeHolder + '\\b', 'g'), show ? '' : 'display:none').replace(new RegExp('@hideIf_' + placeHolder + '\\b', 'g'), show ? 'display:none' : '');
};

function streamWeb_handler(req, res) {
  if (req.url.length > 8 * 1024 || req.method !== 'GET' || req.url === '/favicon.ico') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, urlExt = Path.extname(urlPath), dev = q.device && devMgr[q.device];
  res.__log = cfg.logAllHttpReqRes || !(urlExt === '.html' || urlExt === '.js' || urlExt === '.css' || urlPath === '/getFile' || urlPath === '/touch' || (urlPath === '/capture' && q.type === 'jpg' && q.timestamp));
  res.__log && log((res.__tag = '[' + cfg.streamWeb_protocol + '_' + (res.seq = ++httpSeq) + ']') + ' ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (cfg.logHttpReqDetail ? ' [from ' + req.connection.remoteAddress + ':' + req.connection.remotePort + ']' : '') + (cfg.logHttpReqDetail ? '[' + req.headers['user-agent'] + ']' : ''));
  if (urlExt === '.js' || urlExt === '.css') {
    return end(res, htmlCache[urlPath], urlExt === '.css' ? 'text/css' : urlExt === '.js' ? 'text/javascript' : '');
  }
  setDefaultHttpHeaderAndInitCloseHandler(res);
  _streamWeb_handler(req, res, q, urlPath, dev);
}
function _streamWeb_handler(req, res, q, urlPath, dev, fromAdminWeb) {
  if (!dev && (chk.err = '`device`: unknown device') || dev.accessKey && q.accessKey !== dev.accessKey.slice(11) && (chk.err = 'access denied')) {
    return end(res, chk.err);
  }

  switch (urlPath) {
    case '/capture': //---------------------------send capture result to browser & optionally save to file------------
      if (!chkCaptureParameter(dev, q, /*force_ajpg:*/false)) {
        return end(res, chk.err);
      }
      q._isSafari = /Safari/i.test(req.headers['user-agent']) && !/Chrome/i.test(req.headers['user-agent']);
      return doCapture(dev, res, q);
    case '/saveImage': //------------------------------Save Current Image From Live View------------------------------
      if ((!dev.capture || !dev.capture.image) && (chk.err = 'error: no live image') ||
          !cfg.enableGetOutputFile && !fromAdminWeb && (chk.err = 'access denied')) {
        return end(res, chk.err);
      }
      q.filename = querystring.escape(q.device) + '~live_' + dev.capture.q._hash + '_' + dev.capture.q.timestamp + '~frame' + String.fromCharCode(65 + String(dev.capture.image.i).length - 1) + dev.capture.image.i + '.jpg';
      fs.writeFile(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, dev.capture.image.buf, function (err) {
        err ? log(err) : (dev.subOutputDir && fs.link(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, cfg.outputDir + '/' + q.filename, log.nonEmpty));
      });
      return end(res, 'OK: ' + q.filename);
    case '/liveViewer.html':  //-------------------------show live capture (Just as a sample) ------------------------
      if (!chkCaptureParameter(dev, q, /*force_ajpg:*/true)) {
        return end(res, chk.err);
      }
      return end(res, replaceComVar(htmlCache[urlPath], dev).replaceShowIf('masterMode', dev.masterMode)
              .replace(/@size\b/g, q._old.size || '').replace(/@orient\b/g, q._old.orient || '').replace(/@fastResize\b/g, q._old.fastResize || '').replace(/@fastCapture\b/g, q._old.fastCapture || '')
              .replace(/@res_size\b/g, (dev.capture && dev.capture.q || q).size).replace(/@res_orient\b/g, (dev.capture && dev.capture.q || q).orient).replace(/@res_fastCapture\b/g, (dev.capture && dev.capture.q || q).fastCapture).replace(/@res_fastResize\b/g, (dev.capture && dev.capture.q || q).fastResize)
              .replace(/checkedIf_res_fastCapture\b/g, (dev.capture && dev.capture.q || q).fastCapture ? 'checked' : '').replace(/checkedIf_res_fastResize\b/g, (dev.capture && dev.capture.q || q).fastResize ? 'checked' : '')
              .replace(/enabledIf_can_fastCapture\b/g, dev.fastLibPath ? '' : 'disabled').replace(/enabledIf_can_fastResize\b/g, !!dev.fastLibPath || dev.libPath >= './sc-400' ? '' : 'disabled')
          , 'text/html');
    case '/videoViewer.html': //--------------------show video file  (Just as a sample)-------------------------------
    case '/imageViewer.html': //--------------------show image file  (Just as a sample)-------------------------------
      if (!cfg.enableGetOutputFile && !fromAdminWeb) {
        return end(res, 'access denied');
      }
      return fs.readdir(cfg.outputDir, function (err, filenameAry) {
        if (err) {
          return end(res, stringifyError(err));
        }
        var filenameMap = {/*sortKey:*/}, isImage = (urlPath === '/imageViewer.html');
        filenameAry.forEach(function (f) {
          (f = new FilenameInfo(f, q.device)).isValid && isImage === (f.type === 'jpg') && (isImage || !dev.recordingFileTimestampSet[f.timestamp])
          && (filenameMap[f.timestamp + (f.i || '')] = f);
        });
        var sortedKeys = Object.keys(filenameMap).sort().reverse();
        if (!isImage) { //videoViewer
          if (!(q.filename = filenameMap[sortedKeys[q.fileindex = Number(q.fileindex) || 0]])) {
            return end(res, sortedKeys.length ? '`fileindex`: file not found' : 'error: file not found');
          }
          return end(res, replaceComVar(htmlCache[urlPath], dev)
                  .replace(/@fileindex\b/g, q.fileindex).replace(/@filename\b/g, querystring.escape(q.filename))
                  .replace(/@timestamp\b/g, stringifyTimestampShort(q.filename.timestamp))
                  .replace(/@fileCount\b/g, sortedKeys.length).replace(/@maxFileindex\b/g, String(sortedKeys.length - 1))
                  .replace(/@olderFileindex\b/g, Math.min(q.fileindex + 1, sortedKeys.length - 1)).replace(/@newerFileindex\b/g, String(Math.max(q.fileindex - 1, 0)))
                  .replace(/@fileSize\b/g, getFileSizeSync(cfg.outputDir + '/' + q.filename).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','))
                  .replace(/@unprotect&/g, q.adminKey ? 'adminKey=' + querystring.escape(q.adminKey) + '&' : '')
              , 'text/html');
        } else {
          return end(res, replaceComVar(htmlCache[urlPath], dev)
              .replace(/@count\b/g, sortedKeys.length)
              .replace(/@unprotect&/g, q.adminKey ? 'adminKey=' + querystring.escape(q.adminKey) + '&' : '')
              .replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
                return sortedKeys.reduce(function (joinedStr, key) {
                  return joinedStr + htmlBlock.replace(/@filename\b/g, querystring.escape(filenameMap[key]));
                }, ''/*initial joinedStr*/);
              }), 'text/html');
        }
      });
    case '/getFile': //---------------------------get video/image file------------------------------------------------
      if (!cfg.enableGetOutputFile && !fromAdminWeb && (chk.err = 'access denied')
          || !(q.filename = new FilenameInfo(q.filename, q.device)).isValid && (chk.err = '`filename`: invalid name')) {
        return end(res, chk.err);
      }
      if ((q._range = (req.headers.range || '').match(re_httpRange))) {
        if (!(q._fileSize = getFileSizeSync(cfg.outputDir + '/' + q.filename))) {
          return end(res, chk.err);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        q._range.start = q._range[1] && Math.min(q._range[1], q._fileSize - 1) || 0;
        q._range.end = q._range[2] && Math.min(Math.max(q._range[2], q._range.start), q._fileSize - 1) || (q._fileSize - 1);
        res.setHeader('Content-Range', 'bytes ' + q._range.start + '-' + q._range.end + '/' + q._fileSize);
        res.setHeader('Content-Length', q._range.end - q._range.start + 1);
        res.statusCode = 206/*Partial Content*/;
      }
      q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + q.filename);
      res.setHeader('Content-Type', q.filename.type === 'mp4' ? 'video/mp4' : q.filename.type === 'jpg' ? 'image/jpeg' : '');
      return fs.createReadStream(cfg.outputDir + '/' + q.filename, q._range)
          .on('error', function (err) {
            end(res, stringifyError(err));
          }).pipe(res);
    case '/touch':
      if (!chk('type', q.type, ['d', 'u', 'o', 'm']) || !chk('x', q.x = Number(q.x), 0, 1) || !chk('x', q.y = Number(q.y), 0, 1)) {
        return end(res, JSON.stringify(chk.err), 'text/json');
      }
      if (!dev.capture || !dev.capture.image) {
        return end(res, JSON.stringify('device is not being live viewed'), 'text/json');
      }
      if (dev.touchStatus !== 'OK') {
        return end(res, JSON.stringify(dev.touchStatus || 'not prepared'), 'text/json');
      } else {
        sendTouchEvent(dev, q);
        return end(res, JSON.stringify('OK'), 'text/json');
      }
    case '/sendKey':
      if (!chk('keyCode', q.keyCode = Number(q.keyCode), [3, 4, 82, 26, 187, 66, 67, 112])) {
        return end(res, chk.err);
      }
      spawn('[SendKey ' + q.device + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', 'input', 'keyevent', q.keyCode), {
        timeout: cfg.adbSendKeyTimeout * 1000,
        log: cfg.logAllAdbCommands
      });
      return end(res, 'OK');
    case '/sendText':
      if (!chk('text', q.text)) {
        return end(res, chk.err);
      }
      spawn('[sendText ' + q.device + ']', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', [].concat('input', 'text', "'" + q.text + "'").join(' ')), {
        timeout: cfg.adbSendKeyTimeout * 1000,
        log: cfg.logAllAdbCommands
      });
      return end(res, 'OK');
    case '/turnOnScreen':
      turnOnScreen(dev);
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
  if (req.url.length > 8 * 1024 || req.method !== 'GET' || req.url === '/favicon.ico') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, urlExt = Path.extname(urlPath), dev = q.device && devMgr[q.device];
  res.__log = cfg.logAllHttpReqRes || !(urlExt === '.html' || urlExt === '.js' || urlExt === '.css' || urlPath === '/getFile' || urlPath === '/touch' || (urlPath === '/capture' && q.type === 'jpg' && q.timestamp) || urlPath === '/' || urlPath === '/status' || urlPath === '/getServerLog' + cfg.adminUrlSuffix || urlPath === '/cmd' + cfg.adminUrlSuffix);
  res.__log && log((res.__tag = '[' + cfg.adminWeb_protocol.toUpperCase() + '_' + (res.seq = ++httpSeq) + ']') + ' ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (cfg.logHttpReqDetail ? ' [from ' + req.connection.remoteAddress + ':' + req.connection.remotePort + ']' : '') + (cfg.logHttpReqDetail ? '[' + req.headers['user-agent'] + ']' : ''));
  if (urlExt === '.js' || urlExt === '.css') {
    return end(res, htmlCache[urlPath], urlExt === '.css' ? 'text/css' : urlExt === '.js' ? 'text/javascript' : '');
  }
  setDefaultHttpHeaderAndInitCloseHandler(res);
  cfg.adminKey && !q.adminKey && req.headers.cookie && (q.adminKey = req.headers.cookie.match(re_adminKey_cookie)) && (q.adminKey = querystring.unescape(q.adminKey[1]));
  if (cfg.adminKey && q.adminKey !== cfg.adminKey) {
    return end(res, htmlCache['/login.html'], 'text/html');
  }

  switch (urlPath) {
    case '/deviceControl': //--------------------------startRecording, stopRecording, stopLiveView', setAccessKey-------
      if (!dev && (chk.err = '`device`: unknown device')
          || !chk('action', q.action, ['startRecording', 'stopRecording', 'stopLiveView', 'setAccessKey'])
          || q.action === 'startRecording' && !chkCaptureParameter(dev, q, /*force_ajpg:*/true, /*forRecording*/true)
          || q.orientation && !chk('orientation', q.orientation, ['landscape', 'portrait', 'free'])) {
        return end(res, chk.err);
      }
      try {
        q.action === 'setAccessKey' && q.subOutputDir && !fs.existsSync(cfg.outputDir + '/' + q.subOutputDir) && fs.mkdirSync(cfg.outputDir + '/' + q.subOutputDir);
      } catch (err) {
        return end(res, stringifyError(err));
      }
      q.action === 'setAccessKey' && (dev.subOutputDir = q.subOutputDir || '');
      q._diff_accessKey = q.accessKey !== undefined && q.accessKey !== dev.accessKey && q.accessKey !== dev.accessKey.slice(11);
      forEachValueIn(dev.consumerMap, function (res) {
        (q._diff_accessKey || (q.action === 'stopRecording' && res.__tag === REC_TAG) || (q.action === 'startRecording' && res.__tag === REC_TAG) || (q.action === 'stopLiveView' && res.__tag !== REC_TAG))
        && endCaptureConsumer(res);
      });
      !Object.keys(dev.consumerMap).length && endCaptureProcess(dev); //end capture process immediately if no any consumer exists
      if (q._diff_accessKey) {
        dev.accessKey = (dev.masterMode = !!q.accessKey) ? getTimestamp().slice(4, 14) + '_' + q.accessKey : newAutoAccessKey();
        scheduleUpdateWholeUI();
      }
      q.orientation && setDeviceOrientation(dev, q.orientation);
      return q.action === 'startRecording' ? end(res, doRecord(dev, q)) : end(res, 'OK');
    case '/cmd' + cfg.adminUrlSuffix:
      return spawn('[cmd]', cfg.adb, cfg.adbOption.concat('-s', q.device, 'shell', q.cmd), function/*on_close*/(ret, stdout, stderr) {
        end(res, stdout || stringifyError(stderr) || (ret !== 0 ? 'unknown error' : ''), 'text/plain');
      }, {timeout: (Number(q.timeout) || cfg.adbCmdTimeout) * 1000, noLogStdout: true, log: cfg.logAllAdbCommands});
    case '/': //---------------------------------------show menu of all devices---------------------------------------
      q.viewUrlBase && (q.viewUrlBase = (parsedUrl = Url.parse((q.viewUrlBase.match(/^https?[:][/][/]/) ? '' : (cfg.streamWeb_protocol || cfg.adminWeb_protocol) + '://' ) + q.viewUrlBase)).format());
      return scanAllDevices(/*mode:*/'doNotRepairDeviceFile', function/*on_gotAllRealDev*/(realDeviceList) {
        var html = htmlCache['/home.html'].replaceShowIf('ffmpegOK', ffmpegOK).replace(/@appVer\b/g, status.appVer)
                .replace(/@adminKey\b/g, querystring.escape(cfg.adminKey)).replace(/#adminKey\b/g, htmlEncode(cfg.adminKey)).replace(/@adminUrlSuffix\b/g, cfg.adminUrlSuffix && q.adminUrlSuffix || '')
                .replace(/@viewUrlBase\//g, q.viewUrlBase || '').replace(/#viewUrlBase\b/g, htmlEncode(q.viewUrlBase || '')).replaceShowIf('isStreamWebSeparated', cfg.streamWeb_port)
                .replace(/@androidLogPath\b/g, querystring.escape(cfg.androidLogPath)).replace(/@androidWorkDir\b/g, querystring.escape(cfg.androidWorkDir))
            ;
        ['viewSize', 'viewOrient', 'videoFileFrameRate'].forEach(function (k) {
          html = html.replace(new RegExp('@' + k + '\\b', 'g'), cfg[k]);
        });
        switchList.forEach(function (k) { //set enable or disable of some config buttons for /var? command
          html = html.replace(new RegExp('@' + k + '\\b', 'g'), cfg[k]).replace(new RegExp('@' + k + '_negVal\\b', 'g'), String(!cfg[k])).replace(new RegExp('checkedIf_' + k + '\\b', 'g'), cfg[k] ? 'checked' : '');
        });
        cfg.adminKey && res.setHeader('Set-Cookie', 'adminKey=' + querystring.escape(cfg.adminKey) + '; HttpOnly');
        return end(res, html.replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
          return (cfg.showDisconnectedDevices ? Object.keys(devMgr) : Object.keys(devMgr).filter(function (sn) {
            return realDeviceList.indexOf(sn) >= 0;
          })).sort(function (sn1, sn2) {
                return devMgr[sn1].info_disp.localeCompare(devMgr[sn2].info_disp);
              }).reduce(function (joinedStr, device, i) {
                return joinedStr + replaceComVar(htmlBlock, (dev = devMgr[device]))
                        .replace(/#devErr\b/g, htmlEncode(!dev.status ? '' : dev.status === 'preparing' ? '' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? '' : dev.touchStatus + '.') : dev.status + '.'))
                        .replace(/@devStatusClass\b/g, !dev.status ? '' : dev.status === 'preparing' ? 'devPrep' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? 'devOK' : 'devErr') : 'devErr')
                        .replace(/#accessKey_disp\b/g, htmlEncode(dev.accessKey)).replace(/@masterMode\b/g, dev.masterMode).replace(/@rowNum\b/g, String(i + 1))
              }, ''/*initial joinedStr*/);
        }), 'text/html');
      });
    case '/stopServer':  //------------------------------------stop server management---------------------------------
      end(res, 'OK');
      adminWeb.close();
      streamWeb && streamWeb.close();
      Object.keys(childProcMap).forEach(function (pid) {
        childProcMap[pid].kill('SIGKILL');
      });
      return process.exit(0);
    case '/reloadResource':  //-----------------------------reload resource file to cache-----------------------------
      reloadResource();
      return end(res, 'OK');
    case '/set':
      if (q.size !== undefined || q.orient !== undefined) {
        if (!chkCaptureParameter(null, q)) {
          return end(res, chk.err);
        }
        cfg.viewSize = q.size;
        cfg.viewOrient = q.orient;
      } else if (q.videoFileFrameRate !== undefined) {
        if (!chk('videoFileFrameRate', (q.videoFileFrameRate = Number(q.videoFileFrameRate)), 0.1, 30)) {
          return end(res, chk.err);
        }
        cfg.videoFileFrameRate = q.videoFileFrameRate;
      } else { //-------------------------------------------------Set some internal bool var--------------------------
        forEachValueIn(switchList, function (k) {
          q[k] !== undefined && (cfg[k] = (q[k] === 'true'));
        });
      }
      scheduleUpdateWholeUI();
      return end(res, 'OK');
    case '/status':  //-----------------------------------push live capture status to browser-------------------------
      res.__previousVer = q.ver;
      res.__previousAppVer = q.appVer;
      status.consumerMap[res.__tag || (res.__tag = getTimestamp())] = res;
      res.on('close', function () { //closed by http peer
        delete status.consumerMap[res.__tag];
      });
      return scheduleUpdateLiveUI();
    case '/getServerLog' + cfg.adminUrlSuffix:  //------------------------------get server log---------------------------------------------
      q._logFilePath = log.getLogFilePath(q.logHowManyDaysAgo);
      if (!(q._fileSize = getFileSizeSync(q._logFilePath))) {
        return end(res, chk.err);
      }
      if (q.mode && !chk('size', q.size = Number(q.size), 1, Number.MAX_VALUE)) {
        return end(res, chk.err);
      }
      q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + Path.basename(q._logFilePath)); //remove dir part
      q.device && (res.__oldWrite = res.write) && (res.write = function (buf) {
        forEachValueIn(Buffer.concat([res.__orphanBuf, buf]).toString('binary').split(/\n/), function (s, i, lineAry) {
          (buf = (s.indexOf(q.device) >= 0 || s.indexOf(q.qdevice) >= 0)) && res.__oldWrite(s + '\n', 'binary');
          i === lineAry.length - 1 && !buf && (res.__orphanBuf = new Buffer(s, 'binary'));
        });
      }) && (res.__orphanBuf = new Buffer([])) && (q.qdevice = querystring.escape(q.device));
      return fs.createReadStream(q._logFilePath, {
        start: q.mode === 'tail' ? Math.max(0, Math.min(q._fileSize - 1, q._fileSize - q.size)) : 0,
        end: q.mode === 'head' ? Math.max(0, Math.min(q._fileSize - 1, q.size - 1)) : (q._fileSize - 1)
      }).on('error', function (err) {
        end(res, stringifyError(err));
      }).pipe(res);
    case '/prepareAllDevices':  //-----------------------prepare device file/touchInfo/apk forcibly ------------------
      scanAllDevices(/*mode:*/q.mode);
      return end(res, 'OK');
    default:
      return _streamWeb_handler(req, res, q, urlPath, dev, /*fromAdminWeb:*/true);
  }
} //end of adminWeb_handler

function reloadResource() {
  scheduleUpdateWholeUI();
  fs.readdirSync('./html').forEach(function (filename) {
    htmlCache['/' + filename] = fs.readFileSync('./html/' + filename).toString();
  });
  fs.readdirSync(cfg.outputDir).forEach(function (filename) {
    (filename = new FilenameInfo(filename)).isValid && getOrCreateDevCtx(filename.device);
  });
  prepareDeviceFile.ver = fs.readdirSync(cfg.binDir).sort().reduce(function (hash, filename) {
    return hash.update(filename.match(/^\./) ? '' : fs.readFileSync(cfg.binDir + '/' + filename));
  }, crypto.createHash('md5')/*initial value*/).digest('hex');
}

reloadResource();
spawn('[CheckAdb]', cfg.adb, cfg.adbOption.length ? ['version'] : ['devices'], function/*on_close*/(ret) {
  if (ret !== 0) {
    log('Failed to check "Android Debug Bridge". Please install it from http://developer.android.com/tools/sdk/tools-notes.html and add path INSTALLED_DIR/platform-tools into PATH env var or set full path of adb to "adb" in config.json or your own config file', {stderr: true});
    return process.exit(1);
  }
  return spawn('[CheckFfmpeg]', cfg.ffmpeg, ['-version'], function/*on_close*/(ret) {
    !(ffmpegOK = (ret === 0)) && log('Failed to check FFMPEG (for this machine, not for Android device). You can record video in H264/MP4 format. Please install it from http://www.ffmpeg.org/download.html and add the ffmpeg\'s dir to PATH env var or set full path of ffmpeg to "ffmpeg" in config.json or your own config file', {stderr: true});
    adminWeb = cfg.adminWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync(cfg.adminWeb_cert)}, adminWeb_handler) : require('http').createServer(adminWeb_handler);
    adminWeb.listen(cfg.adminWeb_port, cfg.adminWeb_ip === '*' ? undefined/*all ip4*/ : cfg.adminWeb_ip, function/*on_httpServerReady*/() {
      if (cfg.streamWeb_port) {
        streamWeb = cfg.streamWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync(cfg.streamWeb_cert)}, streamWeb_handler) : require('http').createServer(streamWeb_handler);
        streamWeb.listen(cfg.streamWeb_port, cfg.streamWeb_ip === '*' ? undefined/*all ip4*/ : cfg.streamWeb_ip, function/*on_httpServerReady*/() {
          log('OK. You can start from ' + cfg.adminWeb_protocol + '://localhost:' + cfg.adminWeb_port + '/' + (cfg.adminKey ? '?adminKey=' + querystring.escape(cfg.adminKey) : ''), {stderr: true});
        });
      } else {
        log('OK. You can start from ' + cfg.adminWeb_protocol + '://localhost:' + cfg.adminWeb_port + '/' + (cfg.adminKey ? '?adminKey=' + querystring.escape(cfg.adminKey) : ''), {stderr: true});
      }
    });
    setInterval(scanAllDevices, cfg.adbDeviceListUpdateInterval * 1000);
  }, {timeout: 10 * 1000, log: true});
}, {timeout: 30 * 1000, log: true});
