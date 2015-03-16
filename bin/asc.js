'use strict';
var old_work_dir = process.cwd();
process.chdir(__dirname); //set dir of current file as working dir
var child_process = require('child_process'), fs = require('fs'), Url = require('url'), querystring = require('querystring'), Path = require('path'), crypto = require('crypto'), util = require('util'), net = require('net'), os = require('os'),
    jsonFile = require('./node_modules/jsonFile.js'), logger = require('./node_modules/logger.js'),
    cfg = util._extend(jsonFile.parse('./config.json'), process.argv[2/*first param*/] && jsonFile.parse(Path.resolve(old_work_dir, process.argv[2]))), //combine user provided configuration file with base file
    log = logger.create(cfg && cfg.log_filePath, cfg && cfg.log_keepOldFileDays);
log('===================================pid:' + process.pid + '=======================================\nuse configuration: ' + JSON.stringify(cfg, null, '  '));
process.on('uncaughtException', function (err) {
  log('uncaughtException: ' + err + "\n" + err.stack, {stderr: true});
  throw err;
});
var adminWeb, streamWeb, devGrpMap = {/*sn:*/}, devAry = [], status = {consumerMap: {/*consumerId:*/}}, htmlCache = {/*'/'+filename:*/}, procMap = {/*pid:*/}, adminWeb_handlerMap = {/*urlPath:*/}, streamWeb_handlerMap = {/*urlPath:*/}, httpSeq = 0, websocket;
var CrLfBoundTypeCrLf2 = new Buffer('\r\n--MULTIPART_BOUNDARY\r\nContent-Type: image/jpeg\r\n\r\n');
var ERR_DEV_NOT_FOUND = 'error: device not found', REC_TAG = '[REC]', CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = new Buffer([CR]), EMPTY_BUF = new Buffer([]);
var re_filename = /^(([^\/\\]+)~(?:live|rec)_[fF]\d+[^_]*_(\d{14}\.\d{3}(?:\.[A-Z]?\d+)?)(?:\.ajpg)?)(?:(?:\.(mp4))|(?:~frame([A-Z]?\d+)\.(jpg)))$/,
    re_size = /^0{0,3}([1-9][0-9]{0,3})x0{0,3}([1-9][0-9]{0,3})$|^0{0,3}([1-9][0-9]{0,3})x(?:Auto)?$|^(?:Auto)?x0{0,3}([1-9][0-9]{0,3})$/i,
    cookie_id_head = '_' + crypto.createHash('md5').update(os.hostname()).digest().toString('hex') + '_' + cfg.adminWeb_port + '_',
    re_httpRange = /^bytes=(\d*)-(\d*)$/i, re_adminKey_cookie = new RegExp('\\b' + cookie_id_head + 'adminKey=([^;]+)'), re_repeatableHtmlBlock = /<!--repeatBegin-->\s*([^\0]*)\s*<!--repeatEnd-->/g;
var switchList = ['showDisconnectedDevices', 'logFfmpegDebugInfo', 'logFpsStatistic', 'logHttpReqDetail', 'logAllProcCmd', 'logAllHttpReqRes', 'logAdbBridgeDetail', 'logAdbBridgeReceivedData', 'logRdcWebSocketDetail', 'fastResize', 'fastCapture', 'checkDevTimeLimit', 'adbBridge', 'debugBrowserScript'];
var keyCodeList = [3/*home*/, 4/*back*/, 82/*menu*/, 26/*power*/, 187/*apps*/, 66/*enter*/, 67/*del*/, 112/*forward_del*/];
true === false && log({log_filePath: '', log_keepOldFileDays: 0, adb: '', adbHosts: [], ffmpeg: '', binDir: '', androidWorkDir: '', androidLogPath: '', streamWeb_ip: '', streamWeb_port: 0, streamWeb_protocol: '', streamWeb_cert: '', adminWeb_ip: '', adminWeb_port: 0, adminWeb_protocol: '', adminWeb_cert: '', outputDir: '', enableGetOutputFile: false, maxRecordTime: 0, logHowManyDaysAgo: 0, download: false, adbGetDeviceListTimeout: 0, adbDeviceListUpdateInterval: 0, adbKeepDeviceAliveInterval: 0, stack: {}, logFfmpegDebugInfo: false, logFpsStatistic: false, logHttpReqDetail: false, showDisconnectedDevices: false, logAllProcCmd: false, adbEchoTimeout: 0, adbFinishPrepareFileTimeout: 0, adbPushFileToDeviceTimeout: 0, adbCheckDeviceTimeout: 0, adbCaptureExitDelayTime: 0, adbSendKeyTimeout: 0, adbTouchTimeout: 0, adbSetOrientationTimeout: 0, adbCmdTimeout: 0, adbTurnScreenOnTimeout: 0, adbScanPerHostDelay: 0, fpsStatisticInterval: 0, logAllHttpReqRes: false, logAdbBridgeDetail: false, logRdcWebSocketDetail: false, resentUnchangedImageInterval: 0, resentImageForSafariAfter: 0, adminUrlSuffix: '', viewUrlBase: '', ajaxAllowOrigin: '', checkDevTimeLimit: true, cookie: '', range: '', orientation: '', httpRequest: {}, binaryData: {}, accept: Function, reject: Function, adbBridge: false, debugBrowserScript: false, __end: 0});

function spawn(tag, _path, args, _on_close/*(err, stdout, ret, signal)*/, _opt) {
  var on_close = (typeof(_on_close) === 'function') && _on_close, opt = !on_close && _on_close || _opt || {}, childProc, stdoutBufAry = [], stderrBufAry = [], timer, procErr;
  opt.log === undefined && (opt.log = cfg.logAllProcCmd);
  opt.logStdout === undefined && (opt.logStdout = opt.log);
  opt.logStderr === undefined && (opt.logStderr = true);
  opt.mergeStdout === undefined && (opt.mergeStdout = opt.logStdout || !!on_close);
  opt.mergeStderr === undefined && (opt.mergeStderr = opt.logStderr || !!on_close);
  opt.stdio = opt.stdio || ['ignore'/*stdin*/, 'pipe'/*stdout*/, 'pipe'/*stderr*/];
  opt.log && log(tag + ' spawn \"' + _path + '\" with args: ' + JSON.stringify(args) + ' with timeout(ms):' + (opt.timeout || 'No'));

  childProc = child_process.spawn(_path, args, opt);
  childProc.__tag = tag = tag + (childProc.pid ? '[pid_' + childProc.pid + ']' : '');
  opt.log && log(tag + (childProc.pid ? ' spawned' : ' not spawned'));
  childProc.pid && (procMap[childProc.pid] = childProc);

  opt.mergeStdout && childProc.stdout && childProc.stdout.on('data', function (buf) {
    stdoutBufAry.push(buf);
  });
  opt.mergeStderr && childProc.stderr && childProc.stderr.on('data', function (buf) {
    stderrBufAry.push(buf);
  });
  opt.timeout && (timer = setTimeout(function () {
    (procErr = 'error: timeout') && opt.logStderr && log(tag + ' kill due to timeout(' + opt.timeout + 'ms)');
    childProc.kill('SIGKILL');
  }, opt.timeout));

  childProc.on('error', function (err) {
    (procErr = stringifyError(err).replace('Error: spawn OK', '')) && opt.logStderr && log(tag + ' ' + procErr);
  });
  childProc.once('close', function (ret, signal) { //exited or failed to spawn
    childProc.pid && delete procMap[childProc.pid];
    clearTimeout(timer);
    !procErr && signal && (procErr = 'error: killed by ' + signal) && opt.logStderr && log(tag + ' ' + procErr);
    var stderr = Buffer.concat(stderrBufAry).toString(), stdout = Buffer.concat(stdoutBufAry).toString();
    stdoutBufAry.length = stderrBufAry.length = 0;
    opt.logStdout && stdout && log(stdout, {noNewLine: true, head: tag + '>'});
    opt.logStderr && stderr && log(stderr, {noNewLine: true, head: tag + '2>'});
    opt.log && log(tag + ' exited:' + (ret === null || ret === undefined ? '' : (' ' + ret)) + (signal ? (' ' + signal) : ''));
    on_close && on_close(procErr || stderr, stdout, ret, signal);
  });
  childProc.stdin && childProc.stdin.on('error', function (err) {
    !childProc.stdin.__isEnded && !childProc.stdin.__isClosedByPeer && opt.log && log(tag + '[stdin] ' + err);
  });
  return childProc;
}
function stringifyError(err) {
  return !err ? '' : err.code === 'ENOENT' ? 'error: ENOENT(not found)' : err.code === 'EACCES' ? 'error: EACCES(access denied)' : err.code === 'EADDRINUSE' ? 'error: EADDRINUSE(IP or port already in use)'
      : (!(err = err.toString().trim().split(/\r*\n/)[0].trim()) ? '' : /error/i.test(err) ? err : 'error: ' + err);
}
function fastAdbExec(_tag, dev, cmd, _on_close/*(stderr, stdout)*/, _opt) {
  var on_close = (typeof(_on_close) === 'function') && _on_close, opt = !on_close && _on_close || _opt || {}, stdoutBufAry = [], timer, closed;
  opt.log === undefined && (opt.log = cfg.logAllProcCmd);
  opt.logStdout === undefined && (opt.logStdout = opt.log);
  opt.logStderr === undefined && (opt.logStderr = true);
  opt.mergeStdout === undefined && (opt.mergeStdout = opt.logStdout || !!on_close);
  var tag = _tag.replace(/^(\[[^\] ]+)/, '$1 ' + dev.id);
  opt.log && log(tag + '[FastADB] "' + cmd + '" with timeout(ms):' + (opt.timeout || 'No'));

  var adbCon = net.connect(dev.adbHost.port || 5037, dev.adbHost.host || '127.0.0.1', function /*on_connected*/() {
    opt.log && log(tag + '[FastADB] connection OK');
    adbCon.write(dev.buf_switchTransport);
    var ok = 0;
    adbCon.on('data', function (buf) {
      if (ok < 2) {
        if (buf.length >= 4 && buf.slice(0, 4).toString() === 'OKAY') {
          ok++;
          ok === 1 && adbCon.write(adbHost_makeBuf(new Buffer('shell:' + cmd)));
          ok === 2 && (buf = buf.slice(4));
        } else {
          cleanup(buf.toString());
          return;
        }
      }
      if (ok === 2 && buf.length) {
        opt.mergeStdout && stdoutBufAry.push(buf);
        adbCon.__on_data && adbCon.__on_data(buf);
      }
    });
  });
  adbCon.on('error', function (err) {
    opt.logStderr && log(tag + '[FastADB] ' + err);
    cleanup('error: protocol fault');
  });
  adbCon.once('close', function () {
    opt.log && log(tag + '[FastADB] closed');
    (closed = true) && cleanup();
  });
  opt.timeout && (timer = setTimeout(function () {
    opt.logStderr && log(tag + '[FastADB] cleanup due to timeout(' + opt.timeout + 'ms)');
    cleanup('error: timeout');
  }, opt.timeout));

  adbCon.__cleanup = cleanup;
  adbCon.__tag = tag;
  return adbCon;

  function cleanup(err) {
    if (cleanup.called) return;
    cleanup.called = true;
    clearTimeout(timer);
    !closed && adbCon.end();
    var stdout = Buffer.concat(stdoutBufAry).toString();
    stdoutBufAry.length = 0;
    opt.logStdout && stdout && log(stdout, {noNewLine: true, head: tag + '>'});
    on_close && on_close(err, stdout, err ? 1 : 0, null);
  }
}
function adbHost_makeBuf(buf) {
  return Buffer.concat([new Buffer(hexUint32(buf.length)), buf]);
}

function htmlEncode(text) {
  return text.replace(/[^0-9a-zA-Z]/g, function (match) {
    return match === '&' ? '&amp;' : match === '<' ? '&lt;' : match === '>' ? '&gt;' : match === '"' ? '&quot;' : ('&#' + match.charCodeAt(0) + ';');
  });
}
function forEachValueIn(map, callback) {
  return Object.keys(map).forEach(function (k) {
    return callback(map[k], k, map);
  });
}
function pad234(d, len/*2~4*/) {
  return len === 2 ? ((d < 10) ? '0' + d : d.toString()) : len === 3 ? ((d < 10) ? '00' + d : (d < 100) ? '0' + d : d.toString()) : len === 4 ? ((d < 10) ? '000' + d : (d < 100) ? '00' + d : (d < 1000) ? '0' + d : d.toString()) : d;
}
function hexUint32(d) {
  var h = d.toString(16);
  return d <= 0xf ? '000' + h : d <= 0xff ? '00' + h : d <= 0xfff ? '0' + h : d <= 0xffff ? h : h;
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
function buf2ascii(buf) {
  return buf.toString('ascii').replace('\0', '\\0');
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

function getHttpSourceAddr(req) {
  var ip = req.headers['x-real-ip'] /*reported by nginx reverse proxy*/, directIp = req.connection.remoteAddress;
  directIp = directIp === '::ffff:127.0.0.1' ? 'localhost' : directIp === '127.0.0.1' ? 'localhost' : directIp;
  return (ip ? (ip + ' ') : '') + directIp + ':' + req.connection.remotePort;
}
function write(res, buf) {
  return !res.__isEnded && !res.__isClosedByPeer && res.write(buf);
}
function writeMultipartImage(res, buf, doNotCount) { //Note: this will write next content-type earlier to force Chrome draw image immediately
  return !res.__isEnded && !res.__isClosedByPeer && (doNotCount || (res.__framesWritten = (res.__framesWritten || 0) + 1)) && res.write(Buffer.concat([res.headersSent ? EMPTY_BUF : CrLfBoundTypeCrLf2, buf, CrLfBoundTypeCrLf2]));
}
function end(res, textContent/*optional*/, type) {
  if (!res.__isEnded && !res.__isClosedByPeer) {
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
function FilenameInfo(f, sn) {
  (this.name = f) && (f = f.match(re_filename)) && (this.sn = querystring.unescape(f[2])) && (!sn || this.sn === sn) && (this.src = f[1]) && (this.timestamp = f[3]) && (this.type = f[4] || f[6]) && (f[4]/*isVideo*/ || (this.i = f[5]) !== '') && (this.isValid = true);
}
FilenameInfo.prototype.toString = function () {
  return this.name /*original name*/;
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
function getOrCreateDevCtx(conId/*device serial no or WiFi Adb address:port, maybe same on different host*/, adbHost) {
  var foundDev = null, devGrp = devGrpMap[conId] || (devGrpMap[conId] = []);
  return (!adbHost ? devGrp[0] : devGrp.some(function (dev) {
        return (dev.adbHost ? (dev.adbHost === adbHost) : ((dev.adbHost = adbHost) && (dev.adbArgs = adbHost.adbArgs.concat('-s', conId)))) && (foundDev = dev);
      }) && foundDev) || setDevId((devAry[devAry.length] = {
        conId: conId, sn: conId, info: [], info_htm: '', status: '', touchStatus: '', touch: {}, consumerMap: {}, i: devAry.length,
        adbHost: adbHost, adbArgs: (adbHost ? adbHost.adbArgs : []).concat('-s', conId), adbBridge: true,
        buf_switchTransport: adbHost_makeBuf(new Buffer('host:transport:' + conId)),
        masterMode: false, accessKey: newAutoAccessKey().replace(/^.{10}/, '----------'), subOutputDir: ''
      }));
}
function setDevId(dev) {
  scheduleUpdateWholeUI();
  var devGrp = devGrpMap[dev.sn] || (devGrpMap[dev.sn] = []);
  dev.id = dev.sn + (devGrp.length === 0 ? '' : '(' + (devGrp.length + 1) + ')');
  dev.var = dev.sn.replace(/[^0-9a-zA-Z]/g, function (match) {
    return ('_' + match.charCodeAt(0).toString(16) + '_');
  }) + (devGrp.length === 0 ? '' : '_' + (devGrp.length + 1));
  dev.re_lastViewId_cookie = new RegExp('\\b' + cookie_id_head + 'viewId_' + dev.var + '=([^;]+)');
  return (devGrp[devGrp.length] = dev);
}
function getDev(id) {
  var sn = id.replace(/\(\d+\)$/, ''), seq = sn.length < id.length && id.slice(sn.length + 1, -1), devGrp = devGrpMap[sn], foundDev = null;
  return !devGrp ? null : seq ? devGrp[Number(seq) - 1] : devGrp.some(function (dev) {
    return dev.adbHost && dev.status !== ERR_DEV_NOT_FOUND && (foundDev = dev);
  }) ? foundDev : devGrp[0];
}
function newAutoAccessKey() {
  return !cfg.adminKey ? '' : (getTimestamp().slice(4, 14) + '_' + crypto.createHash('md5').update(cfg.adminKey + Date.now() + Math.random()).digest('hex'));
}

function scanAllDevices(mode/* 'checkPrepare', 'forcePrepare', undefined means repeatScanInBackground */) {
  !cfg.adbHosts.inited && (cfg.adbHosts.inited = true) && cfg.adbHosts.forEach(function (adbHostStr, i) {
    var _host = adbHostStr && String(adbHostStr).replace(/:[^:]*$/, '') || '', _port = adbHostStr && (String(adbHostStr).match(/:(\d+)$/) || [])[1] || '';
    cfg.adbHosts[i] = {host: _host, port: _port, adbArgs: (_host ? ['-H', _host] : []).concat(_port ? ['-P', _port] : [])};
  });
  cfg.adbHosts.forEach(function (adbHost, i) {
    !adbHost.scanning && (adbHost.scanning = true) && setTimeout(function () {
      spawn('[GetAllDevices]', cfg.adb, adbHost.adbArgs.concat('devices'), function/*on_close*/(stderr, stdout) {
        var devList = [];
        !stderr && stdout.split('\n').slice(1/*from second line*/).forEach(function (desc) {
          if ((desc = desc.split('\t')).length > 1 && desc[0] !== '????????????') {
            var conId = desc[0], _status = desc[1], dev = devList[devList.length] = getOrCreateDevCtx(conId, adbHost);
            (dev.status === ERR_DEV_NOT_FOUND || !dev.status) && log('[GetAllDevices] device connected: ' + dev.id);
            dev.status === ERR_DEV_NOT_FOUND && scheduleUpdateWholeUI();
            dev.status === ERR_DEV_NOT_FOUND && (dev.status = dev.touchStatus = '');
            (mode === 'forcePrepare' || mode === 'checkPrepare' || !dev.status || dev._status !== _status || dev.isOsStartingUp)
            && prepareDeviceFile(dev, mode === 'forcePrepare');
            dev._status = _status;
          }
        });
        devAry.forEach(function (dev) {
          if (dev.adbHost === adbHost && devList.indexOf(dev) < 0 && dev.status !== ERR_DEV_NOT_FOUND) {
            dev.status && log('[GetAllDevices] device disconnected: ' + dev.id);
            dev.status = ERR_DEV_NOT_FOUND;
            scheduleUpdateWholeUI();
          }
        });
        !mode && devList.forEach(function (dev) {
          if (dev.status === 'OK' && Date.now() - (dev.lastKeepAliveDateMs || 0) >= cfg.adbKeepDeviceAliveInterval * 1000) {
            dev.lastKeepAliveDateMs = Date.now();
            fastAdbExec('[KeepAlive]', dev, 'a=', {timeout: cfg.adbEchoTimeout * 1000});
          }
        });
        adbHost.scanning = false;
      }, {timeout: cfg.adbGetDeviceListTimeout * 1000, logStderr: cfg.logAllProcCmd}); //end of GetAllDevices
    }, cfg.adbScanPerHostDelay * 1000 * i / cfg.adbHosts.length); //end of setTimeout
  });
}

var cmd_getBaseInfo = ' getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.product.cpu.abi; getprop ro.serialno; getprop ro.product.name; getprop ro.product.device;'
    + ' echo ===; getevent -pS;'
    + ' echo ===; cd ' + cfg.androidWorkDir + ' && cat version || exit;';
var cmd_getExtraInfo = ' cd ' + cfg.androidWorkDir + ' && chmod 700 . * && umask 077 && echo $FILE_VER>version || exit; export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.;'
    + ' echo ===; dumpsys window policy | ./busybox grep -E \'mUnrestrictedScreen=|DisplayWidth=\';'
    + ' echo ===; ./busybox grep -Ec \'^processor\' /proc/cpuinfo;'
    + ' echo ===; ./busybox head -n 1 /proc/meminfo;';
var cmd_getExtraInfo_Rest = ' { echo ===; ./dlopen ./sc-???; echo ===; ./dlopen ./fsc-???; } 2>' + cfg.androidLogPath + ';';
var cmd_getExtraInfo_Rest_500 = ' { echo ===; ./dlopen.pie ./sc-???; echo ===; ./dlopen.pie ./fsc-???; } 2>' + cfg.androidLogPath + ';';

function prepareDeviceFile(dev, force/*optional*/) {
  if (!(dev.status === 'OK' && !force || dev.status === 'preparing')) {
    log('[PrepareDeviceFile for ' + dev.id + '] begin');
    dev.status !== 'preparing' && (dev.status = 'preparing') && scheduleUpdateWholeUI();
    fastAdbExec('[CheckBasicInfo]', dev, cmd_getBaseInfo + (force ? ' rm -r ' + cfg.androidWorkDir + ' 2>/dev/null;' : ''), function/*on_close*/(stderr, stdout) {
      if (stderr) {
        return setStatus(stringifyError(stderr));
      }
      var parts = stdout.trim().split(/\s*===\s*/);
      if (parts.length !== 3) {
        return setStatus('error: failed to check device basic info');
      }
      dev.CrCount = Math.max(0, stdout.match(/\r?\r?\n$/)[0].length - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/); //in unix/linux this will be 0
      dev.info = parts[0].split(/\r*\n/);
      dev.sysVer = Number((dev.info[2] + '.0.0').split('.').slice(0, 3).join('.').replace(/\.([^.]+)$/, '$1')); //4.1.2 -> 4.12
      dev.armv = parseInt(dev.info[3].replace(/^armeabi-v|^arm64-v/, '')) >= 7 ? 7 : 5; //armeabi-v7a -> 7
      dev.info[3] = (dev.info[3] = dev.info[3].replace(/^armeabi-|^arm64-/, '')) == 'v7a' ? '' : dev.info[3];
      getTouchDeviceInfo(dev, parts[1]);
      dev.internalSN = dev.info[4]; //maybe different with external sn
      dev.productModel = dev.info[1];
      dev.productName = dev.info[5];
      dev.productDevice = dev.info[6];
      dev.info.splice(4, 3); //remove last 3 items
      dev.conId.match(/^.+:\d+$/)/*wifi ip:port*/ && dev.internalSN && (dev.sn = dev.internalSN) && setDevId(dev);
      dev.info_htm = htmlEncode(dev.info.join(' ') + (dev.cpuCount === undefined ? '' : ' ' + dev.cpuCount + 'c') + (dev.memSize === undefined ? '' : ' ' + (dev.memSize / 1000).toFixed() + 'm') + (!dev.disp ? '' : ' ' + dev.disp.w + 'x' + dev.disp.h));

      if (!force && parts[2] === prepareDeviceFile.ver) {
        return finishPrepare();
      }
      return spawn('[PushFileToDevice ' + dev.id + ']', cfg.adb, dev.adbArgs.concat('push', cfg.binDir, cfg.androidWorkDir), function/*on_close*/(stderr) {
        if ((stderr = stderr.replace(/push: .*|\d+ files pushed.*|.*KB\/s.*/g, '').replace(/\r*\n/g, ''))) {
          return setStatus(stringifyError(stderr));
        }
        return finishPrepare();
      }, {timeout: cfg.adbPushFileToDeviceTimeout * 1000, log: true}); //end of PushFileToDevice
    }, {timeout: cfg.adbCheckDeviceTimeout * 1000, log: true}); //end of CheckDevice
  }

  function setStatus(status) {
    log('[PrepareFileToDevice ' + dev.id + '] ' + status);
    dev.status !== status && (dev.status = status) && scheduleUpdateWholeUI();
  }

  function finishPrepare() {
    fastAdbExec('[FinishPrepareFile]', dev, cmd_getExtraInfo.replace('$FILE_VER', prepareDeviceFile.ver) + (dev.sysVer >= 5 ? cmd_getExtraInfo_Rest_500 : cmd_getExtraInfo_Rest), function/*on_close*/(stderr, stdout) {
      if (stderr) {
        return setStatus(stringifyError(stderr));
      }
      var parts = stdout.trim().split(/\s*===\s*/);
      if (parts.length !== 6 || parts[0]) {
        return setStatus('error: failed to finish preparing device file');
      } else if (!getMoreInfo(dev, parts)) {
        return setStatus('error: failed to ' + (!dev.libPath ? 'check internal lib' : !dev.disp ? 'check display size' : '?'));
      }
      setDeviceOrientation(dev, 'free');
      return setStatus('OK');
    }, {timeout: cfg.adbFinishPrepareFileTimeout * 1000, log: true});
  } //end of FinishPrepareFile

  function getMoreInfo(dev, ary/*result of cmd_getExtraInfo*/) {
    dev.isOsStartingUp = (ary[1] === "Can't find service: window");
    (ary[1] = ary[1].match(/([1-9]\d\d+)\D+([1-9]\d\d+)/)) && (dev.disp = {w: Math.min(ary[1][1], ary[1][2]), h: Math.max(ary[1][1], ary[1][2])}) && [1, 2, 4, 5, 6, 7].forEach(function (i) {
      dev.disp[i] = {w: Math.ceil(dev.disp.w * i / 8 / 2) * 2, h: Math.ceil(dev.disp.h * i / 8 / 2) * 2};
    });
    dev.cpuCount = Number(ary[2]) || 1;
    (ary[3] = ary[3].match(/\d+/)) && (dev.memSize = Number(ary[3][0]));
    dev.libPath = ary[4].split(/\r*\n/).sort().pop();
    dev.fastLibPath = ary[5].split(/\r*\n/).sort().pop();
    dev.info_htm = htmlEncode(dev.info.join(' ') + (dev.cpuCount === undefined ? '' : ' ' + dev.cpuCount + 'c') + (dev.memSize === undefined ? '' : ' ' + (dev.memSize / 1000).toFixed() + 'm') + (!dev.disp ? '' : ' ' + dev.disp.w + 'x' + dev.disp.h));
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
            log('[GetTouchDevInfo ' + dev.id + ']' + ' strange: max_x=' + match['0035'][1] + ' max_y=' + match['0036'][1]);
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
    log('[GetTouchDevInfo ' + dev.id + ']' + ' ' + dev.touchStatus + ' ' + (dev.touchStatus === 'OK' ? JSON.stringify(dev.touch) : ''));
  }
} //end of prepareDeviceFile

function runCmdInOrderIgnoreResult(dev, cmd) {
  !dev.shell && (dev.shell = spawn('[Shell ' + dev.id + ']', cfg.adb, dev.adbArgs.concat('shell'), function/*on_close*/() {
    dev.shell = null;
  }, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'pipe'/*stderr*/], log: true}));
  if (dev.shell.stdin) {
    cfg.logAllProcCmd && log(cmd, {head: '[Shell ' + dev.id + ']' + '$ '});
    dev.shell.stdin.write(cmd + '\n');
  }
}
function sendTouchEvent(dev, type, _x, _y) {
  var x = (_x * dev.touch.w).toFixed(), y = (_y * dev.touch.h).toFixed(), cmd = '';
  if (!(type === 'm' && dev.touchLast_x === x && dev.touchLast_y === y)) { //ignore move event if at same position
    if (dev.touch.maxTrackId === 65535) {
      if (type === 'd') { //down
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
      } else if (type === 'm') { //move
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
      if (type === 'd' || type === 'm') { //down, move
        cmd += dev.touch.cmdHead + ' 3 ' + 0x30 + ' ' + dev.touch.avgContactSize + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
        dev.touch.avgPressure && (cmd += dev.touch.cmdHead + ' 3 ' + 0x3a + ' ' + dev.touch.avgPressure + '; '); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
      } else { //up, out
        cmd += dev.touch.cmdHead + ' 3 ' + 0x30 + ' ' + 0 + '; '; //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
        dev.touch.avgPressure && (cmd += dev.touch.cmdHead + ' 3 ' + 0x3a + ' ' + 0 + '; '); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
      }
      cmd += dev.touch.cmdHead + ' 0 2 0; '; //SYN_MT_REPORT   this is very important
      if (dev.touch.needBtnTouchEvent && (type === 'd' || type === 'u' || type === 'o')) {
        cmd += dev.touch.cmdHead + ' 1 ' + 0x014a + ' ' + (type === 'd' ? 1 : 0) + '; '; //BTN_TOUCH DOWN for sumsung devices
      }
      cmd += dev.touch.cmdHead + ' 0 0 0; '; //SYN_REPORT
    }

    cmd && runCmdInOrderIgnoreResult(dev, cmd);

    if (type === 'd' || type === 'm') { //down, move
      dev.touchLast_x = x;
      dev.touchLast_y = y;
    }
  }
}
function errTouchArgs(dev, type, x, y) {
  return (!dev && (chk.err = 'device not opened')) || (dev.status !== 'OK' && (chk.err = 'device not ready'))
      || (dev.touchStatus !== 'OK' && (chk.err = 'touch device not prepared'))
      || (!(dev.capture && dev.capture.image) && (chk.err = 'device is not being live viewed'))
      || !chk('type', type, ['d', 'm', 'u', 'o']) || !chk('x', x, 0, 1) || !chk('y', y, 0, 1)
}
function setDeviceOrientation(dev, orientation) {
  setDeviceOrientation.proc && setDeviceOrientation.proc.__cleanup();
  setDeviceOrientation.proc = fastAdbExec('[SetOrientation]', dev, 'cd ' + cfg.androidWorkDir + '; ls -d /data/data/jp.sji.sumatium.tool.screenorientation >/dev/null 2>&1 || (echo install ScreenOrientation.apk; pm install ./ScreenOrientation.apk 2>&1 | ./busybox grep -Eo \'^Success$|INSTALL_FAILED_ALREADY_EXISTS\') && am startservice -n jp.sji.sumatium.tool.screenorientation/.OrientationService -a ' + orientation + (dev.sysVer >= 4.22 ? '--user 0' : ''), {timeout: cfg.adbSetOrientationTimeout * 1000});
}
function turnOnScreen(dev) {
  turnOnScreen.proc && turnOnScreen.proc.__cleanup();
  turnOnScreen.proc = dev.sysVer > 2.3 && fastAdbExec('[TurnScreenOn]', dev, 'dumpsys power | ' + (dev.sysVer >= 4.22 ? 'grep' : cfg.androidWorkDir + ' /busybox grep') + ' -q ' + (dev.sysVer >= 4.22 ? 'mScreenOn=false' : 'mPowerState=0') + ' && (input keyevent 26; input keyevent 82)', {timeout: cfg.adbTurnScreenOnTimeout * 1000});
}
function sendKey(dev, keyCode) {
  //fastAdbExec('[SendKey]', dev, 'exec input keyevent ' + keyCode, {timeout: cfg.adbSendKeyTimeout * 1000});
  runCmdInOrderIgnoreResult(dev, 'exec input keyevent ' + keyCode);
}
function sendText(dev, text) {
  //fastAdbExec('[sendText]', dev, 'exec input text ' + text.slice(0, 100).replace(/[\x00-\x20\s]/g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"'), {timeout: cfg.adbSendKeyTimeout * 1000});
  runCmdInOrderIgnoreResult(dev, 'exec input text ' + text.slice(0, 100).replace(/[\x00-\x20\s]/g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"'));
}
function encryptSn(sn) {
  sn = sn || ' ';
  var d, i;
  if (cfg.checkDevTimeLimit) {
    var dt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d = pad234(dt.getFullYear() % 100, 2) + pad234(dt.getMonth() + 1, 2) + pad234(dt.getDate(), 2);
  } else {
    d = '991231';
  }
  var cnt = Math.ceil(sn.length / 6), s = '', es = '';
  for (i = 0; i < cnt; i++) s += d;
  for (i = 0; i < s.length; i++)
    es += ('0' + (s.charCodeAt(i) ^ sn.charCodeAt(i % sn.length)).toString(16)).slice(-2);
  return es;
}

function chkCaptureParameter(dev, req, q, force_ajpg, forRecording) {
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

    !forRecording && req.headers.cookie && (q._lastViewId = req.headers.cookie.match(dev.re_lastViewId_cookie)) && (q._lastViewId = q._lastViewId[1])
    && forEachValueIn(dev.consumerMap, function (res) {
      (res.q.timestamp === q._lastViewId) && endCaptureConsumer(res);
    });
  }
  return true;
}
function _startNewCaptureProcess(dev, q) {
  var capture = dev.capture = {q: q}, bufAry = [], foundMark = false;
  var adbCon = capture.adbCon = fastAdbExec('[CAP ' + q._hash + ']', dev, [].concat('{ date >&2 && cd', cfg.androidWorkDir,
          '&& export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.', (cfg.logFfmpegDebugInfo ? '&& export ASC_LOG_ALL=1' : []), '&& export ASC_=' + encryptSn(dev.internalSN),
          '&& exec ./ffmpeg.armv' + dev.armv + (dev.sysVer >= 5 ? '.pie' : ''), '-nostdin -nostats -loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
          '-f androidgrab -probesize 32'/*min bytes for check*/, (q._reqSz ? ['-width', q._reqSz.w, '-height', q._reqSz.h] : []), '-i', q.fastCapture ? dev.fastLibPath : dev.libPath,
          (q._filter ? ['-vf', '\'' + q._filter + '\''] : []), '-f mjpeg -q:v 1 - ; } 2>', cfg.androidLogPath).join(' ') // "-" means stdout
      , function/*on_close*/() {
        capture === dev.capture && endCaptureProcess(dev);
      }, {logStdout: false, mergeStdout: false, log: true});
  adbCon.__on_data = function (buf) {
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
  };
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
  res.once('close', function () { //closed by http peer
    endCaptureConsumer(res);
  });
  res.setHeader && res.setHeader('Content-Type', q.type === 'ajpg' ? 'multipart/x-mixed-replace;boundary=MULTIPART_BOUNDARY' : 'image/jpeg');
  res.setHeader && q.type === 'ajpg' && res.setHeader('Set-Cookie', cookie_id_head + 'viewId_' + dev.var + '=' + q.timestamp + '; HttpOnly');
  res.setHeader/*http*/ && q.type === 'ajpg' && (res.__statTimer = setInterval(function () {
    res.output.length >= 30 && !res.__didResend && (res.__framesDropped = 28) && (res.output.length = res.outputEncodings.length = res.output.length - res.__framesDropped);
    (cfg.logFpsStatistic || res.__framesDropped) && log(dev.capture.adbCon.__tag + res.__tag + ' statistics: Fps=' + ((res.__framesWritten || 0) / cfg.fpsStatisticInterval).toPrecision(3) + (res.__framesDropped ? ' dropped frames: ' + res.__framesDropped : ''));
    res.__framesWritten = res.__framesDropped = 0;
  }, cfg.fpsStatisticInterval * 1000));
  q.fastCapture && dev.capture.image && (res.setHeader && q.type === 'ajpg') && writeMultipartImage(res, dev.capture.image.buf);
  q.type === 'jpg' && dev.capture.image && endCaptureConsumer(res, dev.capture.image.buf);
  q.type === 'jpg' && dev.capture.image && dev.capture.q !== q && clearTimeout(status.updateLiveUITimer); //remove unnecessary update if not new capture process
}
function doRecord(dev, q/*same as capture*/) {
  var filename = querystring.escape(dev.sn) + '~rec_' + (dev.capture && dev.capture.q || q)._hash + '_' + q.timestamp + '.mp4', outPath = cfg.outputDir + '/' + filename;
  var childProc = spawn('[REC ' + dev.id + ' ' + (dev.capture && dev.capture.q || q)._hash + ']', cfg.ffmpeg, [].concat(
      '-y' /*overwrite output*/, '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
      '-f', 'mjpeg', '-r', cfg.videoFileFrameRate, '-i', '-'/*stdin*/,
      '-pix_fmt', 'yuv420p'/*for safari mp4*/, outPath
  ), function/*on_close*/() {
    dev.subOutputDir && fs.link(outPath, cfg.outputDir + '/' + dev.subOutputDir + '/' + filename, log.nonEmpty);
  }, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'pipe'/*stderr*/], log: true, mergeStderr: false});
  childProc.stdin.__feedConvertTimer = setInterval(function () {
    dev.capture.image && write(childProc.stdin, dev.capture.image.buf);
  }, 1000 / cfg.videoFileFrameRate);
  childProc.stdin.__recordTimer = global.setTimeout(endCaptureConsumer, cfg.maxRecordTime * 1000, childProc.stdin);
  childProc.stdin.__tag = REC_TAG;
  doCapture(dev, childProc.stdin, q);
  return 'OK: ' + filename;
}
function endCaptureConsumer(res/*Any Type Output Stream*/, imageBuf/*optional*/) {
  var dev = getDev(res.q.devId);
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
  dev.capture.adbCon && dev.capture.adbCon.__cleanup();
  dev.capture = null;
  scheduleUpdateLiveUI();
}

function scheduleUpdateLiveUI() {
  if (Object.keys(status.consumerMap).length) {
    clearTimeout(status.updateLiveUITimer);
    status.updateLiveUITimer = setTimeout(function () {
      var sd = {}, json;
      devAry.forEach(function (dev) {
        if (dev.adbHost && dev.status !== ERR_DEV_NOT_FOUND || cfg.showDisconnectedDevices) {
          var liveViewCount = Object.keys(dev.consumerMap).length - (dev.consumerMap[REC_TAG] ? 1 : 0);
          sd['liveViewCount_' + dev.var] = liveViewCount ? '(' + liveViewCount + ')' : '';
          sd['recordingCount_' + dev.var] = dev.consumerMap[REC_TAG] ? '(1)' : '';
          sd['captureParameter_' + dev.var] = dev.capture ? dev.capture.q._disp : '';
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
  res.setHeader('Access-Control-Allow-Origin', cfg.ajaxAllowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.once('close', function () { //closed by http peer
    (res.__isClosedByPeer = true) && res.__log && log(res.__tag + ' CLOSED by peer');
  });
  res.once('finish', function () { //response stream have been flushed and ended without log, such as .pipe()
    !res.__isEnded && (res.__isEnded = true) && res.__log && log(res.__tag + ' END');
  });
  res.on('error', function (err) { //in fact, i'v never been here
    !res.__isEnded && !res.__isClosedByPeer && res.__log && log(res.__tag + ' ' + err);
  });
}
function replaceComVar(html, dev) {
  return html.replace(/@device\b/g, querystring.escape(dev.id)).replace(/#device\b/g, htmlEncode(dev.id)).replace(/\$device\b/g, dev.var).replace(/#adbArgs\b/g, htmlEncode(JSON.stringify(dev.adbArgs || '')))
      .replace(/@accessKey\b/g, querystring.escape(dev.accessKey.slice(11))).replace(/#accessKey\b/g, htmlEncode(dev.accessKey.slice(11))).replace(/#devInfo\b/g, dev.info_htm).replaceShowIf('devInfo', dev.info_htm)
}
String.prototype.replaceShowIf = function (placeHolder, show) {
  return this.replace(new RegExp('@showIf_' + placeHolder + '\\b', 'g'), show ? '' : 'display:none').replace(new RegExp('@hideIf_' + placeHolder + '\\b', 'g'), show ? 'display:none' : '');
};

function streamWeb_handler(req, res) {
  if (req.url.length > 8 * 1024 || req.method !== 'GET' || req.url === '/favicon.ico' || req.url.slice(0, 6) === '/apple') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, urlExt = Path.extname(urlPath), dev = q.device && getDev(q.device);
  dev && (q.devId = dev.id);
  res.__log = cfg.logAllHttpReqRes || !(urlExt === '.html' || urlExt === '.js' || urlExt === '.css' || urlPath === '/getFile' || urlPath === '/touch' || (urlPath === '/capture' && q.type === 'jpg' && q.timestamp));
  res.__log && log((res.__tag = '[' + cfg.streamWeb_protocol + '_' + (++httpSeq) + ']') + ' ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (' [from ' + getHttpSourceAddr(req) + ']') + (cfg.logHttpReqDetail ? '[' + req.headers['user-agent'] + ']' : ''));
  if (urlExt === '.js' || urlExt === '.css') {
    return end(res, htmlCache[urlPath], urlExt === '.css' ? 'text/css' : urlExt === '.js' ? 'text/javascript' : '');
  }
  setDefaultHttpHeaderAndInitCloseHandler(res);
  return _streamWeb_handler(dev, q, urlPath, req, res);
}
function _streamWeb_handler(dev, q, urlPath, req, res) {
  var handler = streamWeb_handlerMap[urlPath];
  if (handler) {
    if (!dev && (chk.err = '`device`: unknown device') || dev.accessKey && q.accessKey !== dev.accessKey.slice(11) && (chk.err = 'access denied')) {
      return end(res, chk.err);
    }
    return handler(dev, q, urlPath, req, res);
  } else {
    return end(res, 'bad request');
  }
}
streamWeb_handlerMap['/capture'] = function (dev, q, urlPath, req, res) {
  if (!chkCaptureParameter(dev, req, q, /*force_ajpg:*/false)) {
    return end(res, chk.err);
  }
  q._isSafari = /Safari/i.test(req.headers['user-agent']) && !/Chrome/i.test(req.headers['user-agent']);
  return doCapture(dev, res, q);
};
streamWeb_handlerMap['/saveImage'] = function (dev, q, urlPath, req, res) {
  if ((!dev.capture || !dev.capture.image) && (chk.err = 'error: no live image')) {
    return end(res, chk.err);
  }
  q.filename = querystring.escape(dev.sn) + '~live_' + dev.capture.q._hash + '_' + dev.capture.q.timestamp + '~frame' + String.fromCharCode(65 + String(dev.capture.image.i).length - 1) + dev.capture.image.i + '.jpg';
  fs.writeFile(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, dev.capture.image.buf, function (err) {
    err ? log(err) : (dev.subOutputDir && fs.link(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, cfg.outputDir + '/' + q.filename, log.nonEmpty));
  });
  return end(res, 'OK: ' + q.filename);
};
streamWeb_handlerMap['/touch'] = function (dev, q, urlPath, req, res) {
  if (errTouchArgs(dev, q.type, q.x = Number(q.x), q.y = Number(q.y))) {
    return end(res, JSON.stringify(chk.err), 'text/json');
  }
  sendTouchEvent(dev, q.type, q.x, q.y);
  return end(res, JSON.stringify('OK'), 'text/json');
};
streamWeb_handlerMap['/sendKey'] = function (dev, q, urlPath, req, res) {
  if (!chk('keyCode', q.keyCode = Number(q.keyCode), keyCodeList)) {
    return end(res, chk.err);
  }
  sendKey(dev, q.keyCode);
  return end(res, 'OK');
};
streamWeb_handlerMap['/sendText'] = function (dev, q, urlPath, req, res) {
  if (!chk('text', q.text)) {
    return end(res, chk.err);
  }
  sendText(dev, q.text);
  return end(res, 'OK');
};
streamWeb_handlerMap['/turnOnScreen'] = function (dev, q, urlPath, req, res) {
  turnOnScreen(dev);
  end(res, 'OK');
};
streamWeb_handlerMap['/setOrientation'] = function (dev, q, urlPath, req, res) {
  if (!chk('orientation', q.orientation, ['landscape', 'portrait', 'free'])) {
    return end(res, chk.err);
  }
  setDeviceOrientation(dev, q.orientation);
  return end(res, 'OK');
};
streamWeb_handlerMap['/liveViewer.html'] = function (dev, q, urlPath, req, res) {
  if (!chkCaptureParameter(dev, req, q, /*force_ajpg:*/true)) {
    return end(res, chk.err);
  }
  return end(res, replaceComVar(htmlCache[urlPath], dev).replaceShowIf('masterMode', dev.masterMode)
          .replace(/@size\b/g, q._old.size || '').replace(/@orient\b/g, q._old.orient || '').replace(/@fastResize\b/g, q._old.fastResize || '').replace(/@fastCapture\b/g, q._old.fastCapture || '')
          .replace(/@res_size\b/g, (dev.capture && dev.capture.q || q).size).replace(/@res_orient\b/g, (dev.capture && dev.capture.q || q).orient).replace(/@res_fastCapture\b/g, (dev.capture && dev.capture.q || q).fastCapture).replace(/@res_fastResize\b/g, (dev.capture && dev.capture.q || q).fastResize)
          .replace(/checkedIf_res_fastCapture\b/g, (dev.capture && dev.capture.q || q).fastCapture ? 'checked' : '').replace(/checkedIf_res_fastResize\b/g, (dev.capture && dev.capture.q || q).fastResize ? 'checked' : '')
          .replace(/enabledIf_can_fastCapture\b/g, dev.fastLibPath ? '' : 'disabled').replace(/enabledIf_can_fastResize\b/g, !!dev.fastLibPath || dev.libPath >= './sc-400' ? '' : 'disabled')
      , 'text/html');
};
streamWeb_handlerMap['/videoViewer.html'] = streamWeb_handlerMap['/imageViewer.html'] = function (dev, q, urlPath, req, res) {
  if (!cfg.enableGetOutputFile && cfg.adminKey && q.adminKey !== cfg.adminKey) {
    return end(res, 'forbidden');
  }
  return fs.readdir(cfg.outputDir, function (err, filenameAry) {
    if (err) {
      return end(res, stringifyError(err));
    }
    var filenameMap = {/*sortKey:*/}, isImage = (urlPath === '/imageViewer.html');
    filenameAry.forEach(function (f) {
      (f = new FilenameInfo(f, dev.sn)).isValid && isImage === (f.type === 'jpg') && (filenameMap[f.timestamp + (f.i || '')] = f);
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
          , 'text/html');
    } else {
      return end(res, replaceComVar(htmlCache[urlPath], dev)
          .replace(/@count\b/g, String(sortedKeys.length))
          .replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
            return sortedKeys.reduce(function (joinedStr, key) {
              return joinedStr + htmlBlock.replace(/@filename\b/g, querystring.escape(filenameMap[key]));
            }, ''/*initial joinedStr*/);
          }), 'text/html');
    }
  });
};
streamWeb_handlerMap['/getFile'] = function (dev, q, urlPath, req, res) {
  if (!cfg.enableGetOutputFile && cfg.adminKey && q.adminKey !== cfg.adminKey && (chk.err = 'forbidden')
      || !(q.filename = new FilenameInfo(q.filename, dev.sn)).isValid && (chk.err = '`filename`: invalid name')) {
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
      .once('error', function (err) {
        end(res, stringifyError(err));
      }).pipe(res);
};

function adminWeb_handler(req, res) {
  if (req.url.length > 8 * 1024 || req.method !== 'GET' || req.url === '/favicon.ico' || req.url.slice(0, 6) === '/apple') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, urlExt = Path.extname(urlPath), dev = q.device && getDev(q.device);
  dev && (q.devId = dev.id);
  res.__log = cfg.logAllHttpReqRes || !(urlExt === '.html' || urlExt === '.js' || urlExt === '.css' || urlPath === '/getFile' || urlPath === '/touch' || (urlPath === '/capture' && q.type === 'jpg' && q.timestamp) || urlPath === '/' || urlPath === '/status' || urlPath === '/getServerLog' + cfg.adminUrlSuffix || urlPath === '/cmd' + cfg.adminUrlSuffix);
  res.__log && log((res.__tag = '[' + cfg.adminWeb_protocol.toUpperCase() + '_' + (++httpSeq) + ']') + ' ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (' [from ' + getHttpSourceAddr(req) + ']') + (cfg.logHttpReqDetail ? '[' + req.headers['user-agent'] + ']' : ''));
  if (urlExt === '.js' || urlExt === '.css') {
    return end(res, htmlCache[urlPath], urlExt === '.css' ? 'text/css' : urlExt === '.js' ? 'text/javascript' : '');
  }
  setDefaultHttpHeaderAndInitCloseHandler(res);
  cfg.adminKey && !q.adminKey && req.headers.cookie && (q.adminKey = req.headers.cookie.match(re_adminKey_cookie)) && (q.adminKey = querystring.unescape(q.adminKey[1]));
  var handler = adminWeb_handlerMap[urlPath];
  if (handler) {
    if (cfg.adminKey && q.adminKey !== cfg.adminKey) {
      return end(res, htmlCache['/login.html'], 'text/html');
    }
    return handler(dev, q, urlPath, req, res);
  } else {
    return _streamWeb_handler(dev, q, urlPath, req, res);
  }
}
adminWeb_handlerMap['/deviceControl'] = function (dev, q, urlPath, req, res) {
  if (!dev && (chk.err = '`device`: unknown device')
      || q.action && !chk('action', q.action, ['startRecording', 'stopRecording', 'stopLiveView', 'setAccessKey'])
      || q.action === 'startRecording' && !chkCaptureParameter(dev, req, q, /*force_ajpg:*/true, /*forRecording*/true)
      || q.orientation && !chk('orientation', q.orientation, ['landscape', 'portrait', 'free'])
      || q.adbBridge && !chk('adbBridge', q.adbBridge, ['true', 'false'])
  ) {
    return end(res, chk.err);
  }
  q._diff_accessKey = q.accessKey !== undefined && q.accessKey !== dev.accessKey && q.accessKey !== dev.accessKey.slice(11);
  if (q.subOutputDir !== undefined && q.subOutputDir !== dev.subOutputDir) {
    try {
      !fs.existsSync(cfg.outputDir + '/' + q.subOutputDir) && fs.mkdirSync(cfg.outputDir + '/' + q.subOutputDir);
    } catch (err) {
      return end(res, stringifyError(err));
    }
    dev.subOutputDir = q.subOutputDir;
  }
  forEachValueIn(dev.consumerMap, function (res) {
    (q._diff_accessKey || (q.action === 'stopRecording' && res.__tag === REC_TAG) || (q.action === 'startRecording' && res.__tag === REC_TAG) || (q.action === 'stopLiveView' && res.__tag !== REC_TAG))
    && endCaptureConsumer(res);
  });
  !Object.keys(dev.consumerMap).length && endCaptureProcess(dev); //end capture process immediately if no any consumer exists
  if (q._diff_accessKey) {
    scheduleUpdateWholeUI();
    dev.accessKey = (dev.masterMode = !!q.accessKey) ? getTimestamp().slice(4, 14) + '_' + q.accessKey : newAutoAccessKey();
  }
  if (dev.adbBridgeWebSocket && (q._diff_accessKey || q.adbBridge === 'false')) {
    dev.adbBridgeWebSocket.close(''/*normal exit*/, 'on demand');
    dev.adbBridgeWebSocket = null;
  }
  q.adbBridge && (dev.adbBridge = (q.adbBridge === 'true'));
  q.orientation && setDeviceOrientation(dev, q.orientation);
  return q.action === 'startRecording' ? end(res, doRecord(dev, q)) : end(res, 'OK');
};
adminWeb_handlerMap['/prepareAllDevices' + cfg.adminUrlSuffix] = function (dev, q, urlPath, req, res) {
  scanAllDevices(/*mode:*/q.mode);
  end(res, 'OK');
};
adminWeb_handlerMap['/getWebHost'] = function (dev, q, urlPath, req, res) {
  end(res, JSON.stringify({adminHost: req.connection.address().address + ':' + cfg.adminWeb_port, streamHost: req.connection.address().address + ':' + cfg.streamWeb_port}), 'text/json');
};
adminWeb_handlerMap['/getAdbHost'] = function (dev, q, urlPath, req, res) {
  end(res, JSON.stringify((dev && dev.adbHost) ? {host: dev.adbHost.host, port: dev.adbHost.port, sn: dev.conId, adbArgs: dev.adbArgs} : '`device`: unknown device'), 'text/json');
};
adminWeb_handlerMap['/'] = function (dev, q, urlPath, req, res) {
  q.viewUrlBase && (q.viewUrlBase = Url.parse((q.viewUrlBase.match(/^https?[:][/][/]/) ? '' : (cfg.streamWeb_protocol || cfg.adminWeb_protocol) + '://' ) + q.viewUrlBase).format());
  var html = htmlCache['/home.html'].replace(/@appVer\b/g, status.appVer).replace(/@adminUrlSuffix\b/g, cfg.adminUrlSuffix && q.adminUrlSuffix || '')
      .replace(/@viewUrlBase\//g, q.viewUrlBase || '').replace(/#viewUrlBase\b/g, htmlEncode(q.viewUrlBase || '')).replaceShowIf('isStreamWebSeparated', cfg.streamWeb_port)
      .replace(/@androidLogPath\b/g, querystring.escape(cfg.androidLogPath)).replace(/@androidWorkDir\b/g, querystring.escape(cfg.androidWorkDir))
      .replace(/@debugBrowserScript\b/g, cfg.debugBrowserScript ? '&debug=true' : '');
  ['viewSize', 'viewOrient', 'videoFileFrameRate'].forEach(function (k) {
    html = html.replace(new RegExp('@' + k + '\\b', 'g'), cfg[k]);
  });
  switchList.forEach(function (k) { //set enable or disable of some config buttons for /var? command
    html = html.replace(new RegExp('@' + k + '\\b', 'g'), cfg[k]).replace(new RegExp('@' + k + '_negVal\\b', 'g'), String(!cfg[k])).replace(new RegExp('checkedIf_' + k + '\\b', 'g'), cfg[k] ? 'checked' : '');
  });
  cfg.adminKey && res.setHeader('Set-Cookie', cookie_id_head + 'adminKey=' + querystring.escape(cfg.adminKey) + '; HttpOnly');
  end(res, html.replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
    return (cfg.showDisconnectedDevices ? devAry : devAry.filter(function (dev) {
      return dev.adbHost && dev.status !== ERR_DEV_NOT_FOUND;
    })).sort(function (dev1, dev2) {
          return dev1.info_htm.localeCompare(dev2.info_htm);
        }).reduce(function (joinedStr, dev, i) {
          return joinedStr + replaceComVar(htmlBlock, dev)
                  .replace(/#devErr\b/g, htmlEncode(!dev.status ? 'no device' : dev.status === 'preparing' ? 'preparing' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? '' : dev.touchStatus) : dev.status))
                  .replace(/@devStatusClass\b/g, !dev.status ? 'devFileOnly' : dev.status === 'preparing' ? 'devPrep' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? 'devOK' : 'devErr') : 'devErr')
                  .replace(/#accessKey_disp\b/g, htmlEncode(dev.accessKey)).replace(/@masterMode\b/g, dev.masterMode).replace(/@rowNum\b/g, String(i + 1))
        }, ''/*initial joinedStr*/);
  }), 'text/html');
};
adminWeb_handlerMap['/getServerLog' + cfg.adminUrlSuffix] = function (dev, q, urlPath, req, res) {
  q._logFilePath = log.getLogFilePath(q.logHowManyDaysAgo);
  if (!(q._fileSize = getFileSizeSync(q._logFilePath) || (q.mode && !chk('size', q.size = Number(q.size), 1, Number.MAX_VALUE)))) {
    return end(res, chk.err);
  }
  q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + Path.basename(q._logFilePath)); //remove dir part
  dev && (res.__oldWrite = res.write) && (res.write = function (buf) {
    Buffer.concat([res.__orphanBuf, buf]).toString('binary').split(/\n/).forEach(function (s, i, lineAry) {
      (buf = (s.indexOf(dev.sn) >= 0 || q.qdevice && s.indexOf(q.qdevice) >= 0)) && res.__oldWrite(s + '\n', 'binary');
      i === lineAry.length - 1 && !buf && (res.__orphanBuf = new Buffer(s, 'binary'));
    });
  }) && (res.__orphanBuf = new Buffer([])) && (q.qdevice = querystring.escape(dev.sn)) === dev.sn && (q.qdevice = '');
  return fs.createReadStream(q._logFilePath, {
    start: q.mode === 'tail' ? Math.max(0, Math.min(q._fileSize - 1, q._fileSize - q.size)) : 0,
    end: q.mode === 'head' ? Math.max(0, Math.min(q._fileSize - 1, q.size - 1)) : (q._fileSize - 1)
  }).once('error', function (err) {
    end(res, stringifyError(err));
  }).pipe(res);
};
adminWeb_handlerMap['/set' + cfg.adminUrlSuffix] = function (dev, q, urlPath, req, res) {
  if (q.size !== undefined || q.orient !== undefined) {
    if (!chkCaptureParameter(null, null, q)) {
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
    switchList.forEach(function (k) {
      q[k] !== undefined && (cfg[k] = (q[k] === 'true'));
    });
  }
  scheduleUpdateWholeUI();
  return end(res, 'OK');
};
adminWeb_handlerMap['/reloadResource' + cfg.adminUrlSuffix] = function (dev, q, urlPath, req, res) {
  reloadResource();
  end(res, 'OK');
};
adminWeb_handlerMap['/cmd' + cfg.adminUrlSuffix] = function (dev, q, urlPath, req, res) {
  !dev ? end(res, '`device`: unknown device') : fastAdbExec('[cmd]', dev, q.cmd, function/*on_close*/(stderr, stdout) {
    end(res, stdout || stringifyError(stderr), 'text/plain');
  }, {timeout: (Number(q.timeout) || cfg.adbCmdTimeout) * 1000, logStdout: false});
};
adminWeb_handlerMap['/stopServer' + cfg.adminUrlSuffix] = function (dev, q, urlPath, req, res) {
  end(res, 'OK');
  adminWeb.close();
  streamWeb && streamWeb.close();
  forEachValueIn(procMap, function (proc) {
    proc.kill('SIGKILL');
  });
  process.exit(0);
};
adminWeb_handlerMap['/status'] = function (dev, q, urlPath, req, res) {
  res.__previousVer = q.ver;
  res.__previousAppVer = q.appVer;
  status.consumerMap[res.__tag || (res.__tag = getTimestamp())] = res;
  res.once('close', function () { //closed by http peer
    delete status.consumerMap[res.__tag];
  });
  scheduleUpdateLiveUI();
};

function createWebSocketServer() {
  new websocket.server({httpServer: (streamWeb ? [adminWeb, streamWeb] : [adminWeb]), autoAcceptConnections: false}).on('request', function (wsConReq) {
    var req = wsConReq.httpRequest, tag = '[' + (req.connection.server === adminWeb ? (cfg.adminWeb_protocol === 'https' ? 'WSS' : 'WS') : (cfg.streamWeb_protocol === 'https' ? 'wss' : 'ws')) + '_' + (++httpSeq) + ']';
    var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, dev = q.device && getDev(q.device);
    log(tag + ' ' + req.url + (' [from ' + getHttpSourceAddr(req) + ']') + (cfg.logHttpReqDetail ? '[' + req.headers['user-agent'] + ']' : '') + (cfg.logHttpReqDetail ? (' origin: ' + wsConReq.origin || '') : ''));
    if (urlPath === '/adbBridge') {
      var bridgeTag = dev ? '[AdbBridge  ' + dev.id + ']' : '';
      if ((!cfg.adbBridge) && (chk.err = 'disabled')
          || (!dev && (chk.err = '`device`: unknown device'))
          || (!dev.adbBridge && (chk.err = 'disabled'))
          || (dev.accessKey && q.accessKey !== dev.accessKey.slice(11) && (chk.err = 'access denied'))
          || (dev.status !== 'OK' && (chk.err = 'error: device not ready'))
      ) {
        log(bridgeTag + tag + ' reject. reason: ' + chk.err);
        return wsConReq.reject();
      }
      log(bridgeTag + tag + ' accept');
      dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.close(''/*normal*/, 'new adbBridge is requested');
      dev.adbBridgeWebSocket = wsConReq.accept(null, wsConReq.origin);
      return handle_adbBridgeWebSocket_connection(dev.adbBridgeWebSocket, dev, bridgeTag, tag);
    }
    else if (urlPath === '/rdc') {
      var rdcTag = '[RDC]';
      log(rdcTag + tag + ' accept');
      var rdcWebSocket = wsConReq.accept(null, wsConReq.origin);
      return handle_rdcWebSocket_connection(rdcWebSocket, rdcTag, tag);
    }
    else {
      log(tag + ' reject. reason: invalid request');
      return wsConReq.reject();
    }
  });
}

var importantAdbCmdSet = {'CNXN': 1, 'OPEN': 1, 'SYNC': 1, 'AUTH': 1, 'CLSE': 1};

function handle_adbBridgeWebSocket_connection(adbBridgeWebSocket, dev, bridgeTag, httpTag) {
  var backendMap = {/*id:*/}, nextBackendId = 0;
  adbBridgeWebSocket.once('close', function (reasonCode, description) {
    log(bridgeTag + httpTag + ' closed. ' + (reasonCode || '') + ' ' + (description || ''));
    forEachValueIn(backendMap, backend_cleanup);
  });
  adbBridgeWebSocket.on('error', function (err) {
    log(bridgeTag + httpTag + ' error: ' + err);
  });
  return adbBridgeWebSocket.on('message', function (msg) {
    if (adbBridgeWebSocket !== dev.adbBridgeWebSocket || !msg.binaryData) return;
    var allBuf = adbBridgeWebSocket.__recvBuf ? Buffer.concat([adbBridgeWebSocket.__recvBuf, msg.binaryData]) : msg.binaryData, payloadLen;
    for (; allBuf.length >= 24 && allBuf.length >= 24 + (payloadLen = allBuf.readUInt32LE(12)); allBuf = allBuf.slice(24 + payloadLen)) {
      handle_adb_command(/*cmd:*/ allBuf.slice(0, 4).toString(), /*arg0:*/ allBuf.readUInt32LE(4), /*arg1:*/ allBuf.readUInt32LE(8), /*payloadBuf:*/ allBuf.slice(24, 24 + payloadLen));
    }
    adbBridgeWebSocket.__recvBuf = allBuf;
  });

  function handle_adb_command(cmd, arg0, arg1, payloadBuf) {
    var backend = backendMap[arg1];
    (cfg.logAdbBridgeDetail || importantAdbCmdSet[cmd]) && log(bridgeTag + ' read  ' + cmd + '(' + hexUint32(arg0) + ', ' + hexUint32(arg1) + ') + ' + hexUint32(payloadBuf.length) + ' bytes' + (payloadBuf.length ? (': "' + buf2ascii(payloadBuf) + '"') : ''));

    if (cmd === 'CNXN') {
      bridge_write('CNXN', /*arg0:A_VERSION*/0x01000000, /*arg1:MAX_PAYLOAD*/0x00001000, new Buffer('device::ro.product.name=' + dev.productName + ';ro.product.model=' + dev.productModel + ';ro.product.device=' + dev.productDevice + ';'));
    }
    else if (cmd === 'OPEN') {
      var serviceBuf = (payloadBuf[payloadBuf.length - 1] ? payloadBuf : payloadBuf.slice(0, -1));
      arg1/*as localId*/ = (nextBackendId === 0xffffffff ? (nextBackendId = 1) : ++nextBackendId);

      backend = backend_create(/*localId:*/arg1, /*remoteId*/arg0);

      backend_write(backend, dev.buf_switchTransport);

      var ok = 0;
      backend.on('data', function (buf) {
        cfg.logAdbBridgeDetail && log(backend.__tag + ' read  ' + hexUint32(buf.length) + ' bytes: "' + buf2ascii(buf) + '"');
        if (ok < 2) {
          if (buf.length >= 4 && buf.slice(0, 4).toString() === 'OKAY') {
            ok++;
            ok === 1 && backend_write(backend, adbHost_makeBuf(serviceBuf));
            ok === 2 && bridge_write('OKAY', /*localId:*/arg1, /*remoteId:*/arg0);
            buf = buf.slice(4);
          } else {
            backend_cleanup(backend);
            return;
          }
        }
        if (ok === 2) {
          while (buf.length) {
            var len = Math.min(4096, buf.length);
            bridge_write('WRTE', /*localId:*/arg1, /*remoteId:*/arg0, buf.slice(0, len));
            buf = buf.slice(len);
          }
        }
      });
    } //end of OPEN
    else {
      if (!backend) {
        backend_cleanup(backend);
      } else if (cmd === 'WRTE') {
        backend_write(backend, payloadBuf);
        bridge_write('OKAY', /*localId:*/arg1, /*remoteId:*/arg0);
      } else if (cmd === 'CLSE') {
        backend_cleanup(backend, /*is_frontend_closed*/true);
      }
    }
  } //end of handle_adb_command

  function bridge_write(cmd, arg0, arg1, payloadBuf) {
    payloadBuf = payloadBuf || EMPTY_BUF;
    cfg.logAdbBridgeDetail && log(bridgeTag + ' write ' + cmd + '(' + hexUint32(arg0) + ', ' + hexUint32(arg1) + ') + ' + hexUint32(payloadBuf.length) + ' bytes' + (cfg.logAdbBridgeDetail ? (': "' + buf2ascii(payloadBuf) + '"') : ''));
    var buf = new Buffer(24 + payloadBuf.length);
    buf.writeUInt8(cmd.charCodeAt(0), 0);
    buf.writeUInt8(cmd.charCodeAt(1), 1);
    buf.writeUInt8(cmd.charCodeAt(2), 2);
    buf.writeUInt8(cmd.charCodeAt(3), 3);
    buf.writeUInt32LE(arg0, 4);
    buf.writeUInt32LE(arg1, 8);
    buf.writeUInt32LE(payloadBuf.length, 12);
    buf.writeUInt32LE(buf.readUInt32LE(0) ^ 0xffffffff, 20, /*noAssert:*/true);
    var sum = 0, i;
    for (i = payloadBuf.length - 1; i >= 0; i--) {
      sum += payloadBuf[i];
    }
    buf.writeUInt32LE(sum, 16);
    payloadBuf.copy(buf, 24);
    adbBridgeWebSocket.send(buf);
  }

  function backend_create(backendId, frontendId/*for peer id*/) {
    var tag = '[AdbBackend ' + dev.id + ']', target = {host: dev.adbHost.host || '127.0.0.1', port: dev.adbHost.port || 5037};
    cfg.logAdbBridgeDetail && log(tag + +hexUint32(backendId) + ' connect to ' + target.host + ':' + target.port);

    var backend = net.connect(target);

    backend.__id = backendId;
    backend.__frontendId = frontendId;
    backend.__tag = tag;
    backendMap[backendId] = backend;

    backend.once('close', function () { //closed by peer
      !backend.__isClosedByPeer && (backend.__isClosedByPeer = true) && cfg.logAdbBridgeDetail && log(tag + ' closed');
      backend_cleanup(backend);
    });
    backend.once('error', function (err) {
      !backend.__isClosedByPeer && !backend.__isEnded && log(tag + ' error: ' + err);
      backend_cleanup(backend);
    });

    return backend;
  }

  function backend_cleanup(backend, is_frontend_closed) {
    if (backend && backendMap[backend.__id]) {
      cfg.logAdbBridgeDetail && log(backend.__tag + ' cleanup');
      delete backendMap[backend.__id];
      backend.removeAllListeners('data');
      if (!backend.__isClosedByPeer && !backend.__isEnded) {
        cfg.logAdbBridgeDetail && log(backend.__tag + ' end');
        (backend.__isEnded = true) && backend.end();
      }
      !is_frontend_closed && bridge_write('CLSE', /*localId:*/0, /*remoteId:*/backend.__frontendId);
    }
  }

  function backend_write(backend, buf) {
    cfg.logAdbBridgeDetail && log(backend.__tag + ' write ' + hexUint32(buf.length) + ' bytes: "' + buf2ascii(buf) + '"');
    backend.write(buf);
  }
} // end of handle_adbBridgeWebSocket_connection

function handle_rdcWebSocket_connection(rdcWebSocket, rdcTag, httpTag) {
  rdcWebSocket.once('close', function (reasonCode, description) {
    log(rdcTag + httpTag + ' closed. ' + (reasonCode || '') + ' ' + (description || ''));
  });
  rdcWebSocket.on('error', function (err) {
    log(rdcTag + httpTag + ' error: ' + err);
  });
  var devHandleMap = {/*devHandle:*/};
  rdcWebSocket.on('message', function (msg) {
    var devHandle, dev, type;
    if (msg.type === 'utf8') {
      var match = msg.utf8Data.match(/^([0-9A-F]+)([:<])([\s\S]+)$/);
      if (!match) { //treat as open_device request
        cfg.logRdcWebSocketDetail && log(rdcTag + ' open device:  "' + msg.utf8Data + '"');
        var parsedUrl = Url.parse(msg.utf8Data, true/*querystring*/), q = parsedUrl.query;
        dev = q.device && getDev(q.device);
        if (!dev && (chk.err = '`device`: unknown device') || dev.accessKey && q.accessKey !== dev.accessKey.slice(11) && (chk.err = 'access denied')) {
          return rdcWebSocket.send(JSON.stringify({err: chk.err}));
        }
        devHandleMap[dev.i] = dev;
        return rdcWebSocket.send(JSON.stringify({devHandle: dev.i}));
      } //end of open_device request

      devHandle = parseInt(match[1], 16);
      type = match[2];
      var body = match[3];
      dev = devHandleMap[devHandle];
      var isSendKey = type === ':', keyCode = isSendKey ? body.charCodeAt(0) : 0;
      cfg.logRdcWebSocketDetail && log(rdcTag + '[Send' + (isSendKey ? 'Key ' : 'Text ') + (dev ? dev.id : '?#' + devHandle) + '] ' + (isSendKey ? keyCode : '"' + body + '"'));
      if ((!dev && (chk.err = 'device not opened')) || (dev.status !== 'OK' && (chk.err = 'device not ready'))
          || (isSendKey && !chk('keyCode', keyCode, keyCodeList))
      ) {
        return rdcWebSocket.send(chk.err);
      }
      isSendKey ? sendKey(dev, keyCode) : sendText(dev, body);
    }
    else { //binary
      if (msg.binaryData.length !== 13) {
        return rdcWebSocket.send('invalid request');
      }
      devHandle = msg.binaryData.readUInt32BE(0);
      type = String.fromCharCode(msg.binaryData.readUInt8(12));
      var x = msg.binaryData.readFloatBE(4),
          y = msg.binaryData.readFloatBE(8);
      dev = devHandleMap[devHandle];
      cfg.logRdcWebSocketDetail && log(rdcTag + '[Touch ' + (dev ? dev.id : '?#' + devHandle) + '] type=' + type + ' x=' + x.toFixed(5) + ' y=' + y.toFixed(5));
      if (errTouchArgs(dev, type, x, y)) {
        return rdcWebSocket.send(chk.err);
      }
      sendTouchEvent(dev, type, x, y);
    }
    return rdcWebSocket.send('');
  });

}

function reloadResource() {
  scheduleUpdateWholeUI();
  fs.readdirSync('./html').forEach(function (filename) {
    htmlCache['/' + filename] = fs.readFileSync('./html/' + filename).toString();
  });
  fs.readdirSync(cfg.outputDir).forEach(function (filename) {
    (filename = new FilenameInfo(filename)).isValid && getOrCreateDevCtx(filename.sn);
  });
  prepareDeviceFile.ver = fs.readdirSync(cfg.binDir).sort().reduce(function (hash, filename) {
    return hash.update(filename.match(/^\./) ? '' : fs.readFileSync(cfg.binDir + '/' + filename));
  }, crypto.createHash('md5')/*initial value*/).digest('hex');
}

reloadResource();
spawn('[CheckAdb]', cfg.adb, ['version'], function/*on_close*/(stderr) {
  if (stderr) {
    log('Failed to check "Android Debug Bridge". Please install it from http://developer.android.com/tools/sdk/tools-notes.html and add path INSTALLED_DIR/platform-tools into PATH env var or set full path of adb to "adb" in config.json or your own config file', {stderr: true});
    return process.exit(1);
  }
  return spawn('[CheckFfmpeg]', cfg.ffmpeg, ['-version'], function/*on_close*/(stderr) {
    stderr && log('Failed to check FFMPEG (for this machine, not for Android device). You can record video in H264/MP4 format. Please install it from http://www.ffmpeg.org/download.html and add the ffmpeg\'s dir to PATH env var or set full path of ffmpeg to "ffmpeg" in config.json or your own config file', {stderr: true});
    try {
      websocket = require('websocket')
    } catch (err) {
    }
    !websocket && log('Failed to check websocket lib. You will not be able to use some advanced function(i.e. AdbBridge via browser). You can install it by command "nmp install websocket" or from "https://github.com/theturtle32/WebSocket-Node"', {stderr: true});
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
    scanAllDevices();
    setInterval(scanAllDevices, cfg.adbDeviceListUpdateInterval * 1000);
    websocket && createWebSocketServer();
  }, {timeout: 10 * 1000, log: true});
}, {timeout: 30 * 1000, log: true});
