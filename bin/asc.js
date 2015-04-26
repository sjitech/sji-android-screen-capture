'use strict';
var old_work_dir = process.cwd();
process.chdir(__dirname); //set dir of current file as working dir
var child_process = require('child_process'), fs = require('fs'), Url = require('url'), querystring = require('querystring'), Path = require('path'), crypto = require('crypto'), util = require('util'), net = require('net'), os = require('os'),
    jsonFile = require('./node_modules/jsonFile.js'), logger = require('./node_modules/logger.js'),
    cfg = util._extend(jsonFile.parse('./config.json'), process.argv[2/*first param*/] && jsonFile.parse(Path.resolve(old_work_dir, process.argv[2]))), //combine user provided configuration file with base file
    log = logger.create(cfg && cfg.log_filePath, cfg && cfg.log_keepOldFileDays);
log('===================================pid:' + process.pid + '=======================================\nuse configuration: ' + JSON.stringify(cfg, null, '  '));
process.on('uncaughtException', function (e) {
  log('uncaughtException: ' + e + "\n" + e.stack);
  process.stderr.write(e + "\n" + e.stack + '\n');
  throw e;
});
var adminWeb, streamWeb, devGrpMap = {/*sn:*/}, devAry = [], status = {consumerMap: {/*consumerId:*/}}, htmlCache = {/*'/'+filename:*/}, procMap = {/*pid:*/}, adminWeb_handlerMap = {/*urlPath:*/}, streamWeb_handlerMap = {/*urlPath:*/}, httpSeq = 0, websocket, fileVer;
var CrLfBoundTypeCrLf2 = new Buffer('\r\n--MULTIPART_BOUNDARY\r\nContent-Type: image/jpeg\r\n\r\n');
var REALLY_USABLE_STATUS = 'device', REC_TAG = '[REC]', CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = new Buffer([CR]), EMPTY_BUF = new Buffer([]),
    touchEventBuf = new Buffer([/*time*/0, 0, 0, 0, 0, 0, 0, 0, /*type*/0, 0, /*code*/0, 0, /*value*/0, 0, 0, 0]);
var re_filename = /^(([^\/\\]+)~(?:live|rec)_[fF]\d+[^_]*_(\d{14}\.\d{3}(?:\.[A-Z]?\d+)?)(?:\.ajpg)?)(?:(?:\.(mp4))|(?:~frame([A-Z]?\d+)\.(jpg)))$/,
    re_size = /^0{0,3}([1-9][0-9]{0,3})x0{0,3}([1-9][0-9]{0,3})$|^0{0,3}([1-9][0-9]{0,3})x(?:Auto)?$|^(?:Auto)?x0{0,3}([1-9][0-9]{0,3})$/i,
    cookie_id_head = '_' + crypto.createHash('md5').update(os.hostname()).digest().toString('hex') + '_' + cfg.adminWeb_port + '_',
    re_httpRange = /^bytes=(\d*)-(\d*)$/i, re_adminKey_cookie = new RegExp('\\b' + cookie_id_head + 'adminKey=([^;]+)'), re_repeatableHtmlBlock = /<!--repeatBegin-->\s*([^\0]*)\s*<!--repeatEnd-->/g;
var switchList = ['showDisconnectedDevices', 'logFfmpegDebugInfo', 'logFpsStatistic', 'logHttpReqDetail', 'logAllProcCmd', 'logAllHttpReqRes', 'logAdbBridgeDetail', 'logAdbBridgeReceivedData', 'logRdcWebSocketDetail', 'fastResize', 'fastCapture', 'checkDevTimeLimit', 'adbBridge'];
var keyNameMap = {3: 'HOME', 4: 'BACK', 82: 'MENU', 26: 'POWER', 187: 'APPS', 66: 'ENTER', 67: 'DELETE', 112: 'FORWARD_DEL'};
//just to avoid compiler warning about undefined properties/methods
true === false && log({log_filePath: '', log_keepOldFileDays: 0, adb: '', adbHosts: [], ffmpeg: '', binDir: '', androidWorkDir: '', androidLogPath: '', streamWeb_ip: '', streamWeb_port: 0, streamWeb_protocol: '', streamWeb_cert: '', adminWeb_ip: '', adminWeb_port: 0, adminWeb_protocol: '', adminWeb_cert: '', outputDir: '', maxRecordTime: 0, logHowManyDaysAgo: 0, download: 0, keyCode: '', text: '', x: 0, y: 0, adbGetDeviceListTimeout: 0, adbKeepDeviceAliveInterval: 0, stack: {}, logFfmpegDebugInfo: 0, logFpsStatistic: 0, logHttpReqDetail: 0, showDisconnectedDevices: 0, logAllProcCmd: 0, adbEchoTimeout: 0, adbFinishPrepareFileTimeout: 0, adbPushFileToDeviceTimeout: 0, adbCheckBasicInfoTimeout: 0, enableGetFileFromStreamWeb: 0});
true === false && log({adbCaptureExitDelayTime: 0, adbSendKeyTimeout: 0, adbTouchTimeout: 0, adbSetOrientationTimeout: 0, adbCmdTimeout: 0, adbTurnScreenOnTimeout: 0, adbScanPerHostDelay: 0, fpsStatisticInterval: 0, logAllHttpReqRes: 0, logAdbBridgeDetail: 0, logRdcWebSocketDetail: 0, resentUnchangedImageInterval: 0, resentImageForSafariAfter: 0, adminUrlSuffix: '', viewUrlBase: '', ajaxAllowOrigin: '', checkDevTimeLimit: true, cookie: '', range: '', orientation: '', httpRequest: {}, binaryData: {}, accept: Function, reject: Function, adbBridge: 0, defaultMaxRecentImageFiles: 0, defaultMaxAdminCmdOutputLength: 0, logCondition: 0, viewSize: '', viewOrient: '', videoFileFrameRate: 0, _isSafari: 0, device: '', adbRetryDeviceTrackerInterval: 0, adbRetryPrepareDeviceInterval: 0, __end: 0});

function dummyFunc() {
}
function spawn(tag, _path, args, _on_close/*(err, stdout, ret, signal)*/, _opt/*{stdio{}, timeout}*/) {
  var on_close = typeof(_on_close) === 'function' ? _on_close : dummyFunc, opt = (typeof(_on_close) === 'function' ? _opt : _on_close) || {}, stdout = [], stderr = [], timer;
  log(tag, 'RUN ' + JSON.stringify(_path) + ' ' + JSON.stringify(args) + (opt.timeout ? ' timeout:' + opt.timeout : ''), false);

  var childProc = child_process.spawn(_path, args, opt);
  childProc.pid && (procMap[childProc.pid] = childProc);

  log(tag, childProc.pid ? ('. OK: pid_' + childProc.pid) : '. FAILED');
  childProc.__tag = tag = tag + (childProc.pid ? ' [pid_' + childProc.pid + ']' : '');

  childProc.stdout && childProc.stdout.on('data', function (buf) {
    log(tag + '>', buf, false);
    on_close.length >= 2 && stdout.push(buf);
  });
  childProc.stderr && childProc.stderr.on('data', function (buf) {
    log(tag + '!', buf, false);
    on_close.length >= 1 && stderr.push(buf);
  });

  opt.timeout && (timer = setTimeout(function () {
    cleanup('timeout');
  }, opt.timeout));

  childProc.on('error', function (e) {
    (e.message !== 'spawn OK') && cleanup('FAILED to spawn', e);
  }).once('close', function (code, signal) { //exited or failed to spawn
    cleanup('CLOSED', '', code, signal);
  });

  childProc.__cleanup = cleanup;
  return childProc;

  function cleanup(reason, detail, code, signal) {
    if (cleanup.called) return;
    (cleanup.called = true) && log(tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : '') + (code === null || code === undefined ? '' : (' ' + code)) + (signal ? (' ' + signal) : ''));
    reason !== 'CLOSED' && childProc.kill('SIGKILL');
    delete procMap[childProc.pid];
    clearTimeout(timer);
    on_close(reason !== 'CLOSED' && reason || signal || (stderr = Buffer.concat(stderr).toString()), (stdout = Buffer.concat(stdout).toString()), code, signal);
  }
}
function fastAdbExec(_tag, devOrHost, cmd, _on_close/*(stderr, stdout)*/, _opt) {
  return fastAdbOpen(_tag, devOrHost, (devOrHost.adbHost ? 'shell:' : 'host:') + cmd, _on_close, _opt);
}
function fastAdbOpen(_tag, devOrHost, service, _on_close/*(stderr, stdout)*/, _opt) {
  var on_close = typeof(_on_close) === 'function' ? _on_close : dummyFunc, opt = (typeof(_on_close) === 'function' ? _opt : _on_close) || {}, stdout = [], stderr = [], timer;
  var isDevCmd = !!devOrHost.adbHost, dev = isDevCmd ? devOrHost : null, adbHost = isDevCmd ? dev.adbHost : devOrHost;
  var tag = _tag.replace(']', ' ' + (isDevCmd ? dev.id : (adbHost.host + ':' + adbHost.port))) + '] [ADB]', _log = cfg.logAllProcCmd || opt.log;
  _log && log(tag, 'OPEN ' + JSON.stringify(service) + (opt.timeout ? ' timeout:' + opt.timeout : ''));

  var adbCon = net.connect(adbHost, function /*on_connected*/() {
    (adbCon.__everConnected = true) && _log && log(tag, 'connection OK');
    var total_matched_len = 0, wanted_payload_len = -1, tmpBuf = EMPTY_BUF, tmpBufAry = [];

    isDevCmd ? adbCon.write(dev.buf_switchTransport) : adbCon.write(adbHost_makeBuf(new Buffer(service)));

    adbCon.on('data', function (buf) {
      if (cleanup.called) return;
      if (stderr.length) return stderr.push(buf);
      if (total_matched_len < (isDevCmd ? 8 : 4)) {
        var match_len = Math.min(buf.length, 4 - total_matched_len % 4), i;
        for (i = 0; i < match_len; i++, total_matched_len++)
          if (buf[i] !== 'OKAY'.charCodeAt(total_matched_len % 4)) return stderr.push(buf); //"FAIL" + hexUint32(msg.byteLength) + msg
        if (total_matched_len !== 4 && total_matched_len !== 8) return;

        if (total_matched_len === 4 && isDevCmd) {
          return adbCon.write(adbHost_makeBuf(new Buffer(service)));
        }
        adbCon.__adb_stream_opened = true;
        adbCon.__on_adb_stream_open && adbCon.__on_adb_stream_open();

        if (!(buf = buf.slice(match_len)).length) return;
      }
      if (isDevCmd) {
        on_close.length >= 2 && stdout.push(buf);
        adbCon.__on_adb_stream_data && adbCon.__on_adb_stream_data(buf);
      }
      else if (on_close.length >= 2 || adbCon.__on_adb_stream_data) {
        do {
          if (wanted_payload_len === -1) {
            tmpBuf = Buffer.concat([tmpBuf, buf]);
            if (tmpBuf.length < 4) return;
            wanted_payload_len = parseInt(tmpBuf.slice(0, 4).toString(), 16); //maybe 0
            if (isNaN(wanted_payload_len)) return cleanup('protocol error(data length)');
            buf = tmpBuf.slice(4);
            tmpBuf.length = 0;
          }
          if (buf.length >= wanted_payload_len) {
            tmpBufAry.push(buf.slice(0, wanted_payload_len));
            buf = buf.slice(wanted_payload_len);
            wanted_payload_len = -1;
            stdout = [Buffer.concat(tmpBufAry)];
            tmpBufAry = [];
            adbCon.__on_adb_stream_data && adbCon.__on_adb_stream_data(stdout[0]);
          } else {
            wanted_payload_len -= buf.length;
            return tmpBufAry.push(buf);
          }
        } while (buf.length);
      } //end of !isDevCmd
    });
  });

  adbCon.on('error', function (e) {
    cleanup('network error', e);
  }).once('close', function () {
    cleanup('CLOSED');
  });

  opt.timeout && (timer = setTimeout(function () {
    cleanup('timeout');
  }, opt.timeout));

  adbCon.__cleanup = cleanup;
  adbCon.__tag = tag;
  isDevCmd && (dev.lastActiveDateMs = Date.now());
  isDevCmd && (dev.adbConMap[adbCon.__id = getTimestamp()] = adbCon);
  return adbCon;

  function cleanup(reason, detail) {
    if (cleanup.called) return;
    (cleanup.called = true) && reason && _log && log(tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
    reason !== 'CLOSED' && adbCon.end();
    isDevCmd && (delete dev.adbConMap[adbCon.__id]);
    if (reason === 'network error') {
      !adbCon.__everConnected && isDevCmd && adbHost.autoStartLocalAdbDaemon && setTimeout(function () {
        spawn('[StartAdbServer]', cfg.adb, ['-P', adbHost.port, 'start-server'], {timeout: 10 * 1000});
      }, 4 * 1000);
    }
    clearTimeout(timer);
    (stdout = Buffer.concat(stdout).toString()) && _log && log(tag + '>', stdout);
    (stderr = Buffer.concat(stderr).toString()) && _log && log(tag + '!', stderr.slice(8) || stderr);
    on_close(reason !== 'CLOSED' && reason || stderr && ('error: ' + (stderr.slice(8) || stderr)), stdout);
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
  for (var k in map) { //noinspection JSUnfilteredForInLoop
    callback(map[k], k, map);
  }
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

function getHttpSourceAddresses(req) {
  var directIp = req.connection.remoteAddress, origIp = req.headers['x-real-ip'] /*reported by nginx reverse proxy*/;
  (directIp === '::ffff:127.0.0.1' || directIp === '127.0.0.1' || directIp === '::1') && (directIp = 'localhost');
  return (origIp ? (origIp + ' ') : '') + directIp;
}
function writeMultipartImage(res, buf, doNotCount) { //Note: this will write next content-type earlier to force Chrome draw image immediately
  (doNotCount || (res.__framesWritten = (res.__framesWritten || 0) + 1))
  && res.write(Buffer.concat([res.headersSent ? EMPTY_BUF : CrLfBoundTypeCrLf2, buf, CrLfBoundTypeCrLf2]));
}
function end(res/*HttpResponse or FileOutput*/, data/*optional*/, type) {
  if (data && res.setHeader && !res.headersSent) { //for unsent http response
    if (type) {
      res.setHeader('Content-Type', type);
    } else if (!Buffer.isBuffer(data)) {
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition'); //remove download flag
    }
  }
  res.__log && log(res.__tag, 'END' + (data && !type && !Buffer.isBuffer(data) ? ': ' + data : ''));
  res.end(data);
}

function getFileSizeSync(filePath) {
  try {
    chk.err = '';
    return fs.statSync(filePath).size;
  } catch (e) {
    chk.err = String(e);
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

function createDev(conId/*serial_no or ip:port, maybe same on different host*/, connectionStatus/*'device','offline',...*/, adbHost) {
  createDev.statusChanged = false;
  var devGrp = devGrpMap[conId] || (devGrpMap[conId] = []), dev = null;
  if (adbHost) {
    if (devGrp.some(function (_dev) { //choose device with same adbHost
          return _dev.adbHost === adbHost && (dev = _dev);
        }) || devGrp.some(function (_dev) { //find empty device (empty adbHost)
          return !_dev.adbHost && (_dev.adbHost = adbHost) && (dev = _dev);
        })) {
      (createDev.statusChanged = (dev.connectionStatus !== connectionStatus)) && (dev.connectionStatus = connectionStatus) && scheduleUpdateWholeUI();
      return dev;
    }
  } else { //fileOnly device
    if ((dev = devGrp[0])) return dev;
  }
  createDev.statusChanged = true;
  dev = devAry[devAry.length] = {
    i: devAry.length, conId: conId, sn: conId,
    adbHost: adbHost, connectionStatus: adbHost && connectionStatus, adbConMap: {},
    status: '', touchStatus: '', touch: {}, info: [], info_htm: '',
    consumerMap: {}, rdcWebSocketMap: {}, adbBridge: true,
    buf_switchTransport: adbHost_makeBuf(new Buffer('host:transport:' + conId)),
    masterMode: false, accessKey: newAutoAccessKey().replace(/^.{10}/, '----------'), subOutputDir: ''
  };
  setDevId(dev);
  return dev;
}
function setDevId(dev) {
  if (dev.connectionStatus || cfg.showDisconnectedDevices) scheduleUpdateWholeUI();
  var devGrp = devGrpMap[dev.sn] || (devGrpMap[dev.sn] = []);
  dev.id = dev.sn + (!devGrp.length ? '' : '~' + (devGrp.length + 1));
  dev.var = dev.sn.replace(/[^0-9a-zA-Z]/g, function (match) {
    return ('_' + match.charCodeAt(0).toString(16) + '_');
  }) + (!devGrp.length ? '' : '_' + (devGrp.length + 1));
  dev.re_lastViewId_cookie = new RegExp('\\b' + cookie_id_head + 'viewId_' + dev.var + '=([^;]+)');
  devGrp[devGrp.length] = dev;
}
function getDev(q /*{[IN]device, [IN]accessKey, [OUT]devHandle}*/, opt) {
  if (!chk('device', q.device)) {
    return null;
  }
  var sn = q.device.replace(/~[1-9][0-9]*$/, ''), devGrp = devGrpMap[sn], dev = devGrp && devGrp[0];
  if (!dev && (chk.err = 'device not found')) {
    return null;
  }
  if (q.device.length > sn.length) { //i.e. q.device: "SerialNo~2", sn = "SerialNo", so grpIndex: 2-1
    if (!(dev = devGrp[Number(q.device.slice(sn.length + 1)) - 1 /*dev index*/]) && (chk.err = 'device not found')) {
      return null;
    }
  } else { //normal case
    devGrp.some(function (_dev) { //find first connected device
      return _dev.connectionStatus && (dev = _dev);
    });
  }
  if (opt.chkAccessKey && dev.accessKey && q.accessKey !== dev.accessKey.slice(11) && (chk.err = 'access denied')
      || !chkDev(dev, opt)) {
    return null;
  }
  q._dev_i = dev.i;
  return dev;
}
function chkDev(dev, opt) {
  var failed = !dev && (chk.err = 'device not found')
      || opt.connected && !(dev.connectionStatus === REALLY_USABLE_STATUS) && (chk.err = 'device not connected')
      || opt.capturing && !(dev.capture && dev.capture.image) && (chk.err = 'screen capturer not started')
      || opt.adbBridge && !(dev.adbBridge && cfg.adbBridge) && (chk.err = 'adbBridge disabled')
      || opt.capturable && !(dev.status === 'OK') && (chk.err = 'device not ready for capturing screen')
      || opt.touchable && !(dev.capture && dev.capture.touchSrv && dev.capture.touchSrv.__adb_stream_opened) && (chk.err = 'device not ready for touch')
      || opt.keybdable && !(dev.capture && dev.capture.keybdSrv && dev.capture.keybdSrv.__adb_stream_opened) && (chk.err = 'device not ready for keyboard');
  return !failed;
}
function newAutoAccessKey() {
  return !cfg.adminKey ? '' : (getTimestamp().slice(4, 14) + '_' + crypto.createHash('md5').update(cfg.adminKey + Date.now() + Math.random()).digest('hex'));
}

function initAdbHosts() {
  cfg.adbHosts.forEach(function (adbHostStr, i) {
    var _host = adbHostStr.replace(/:\d+$/, ''), _port = adbHostStr.slice(_host.length + 1);
    cfg.adbHosts[i] = {host: _host || 'localhost', port: _port || 5037, autoStartLocalAdbDaemon: !_host};
  });
}
function initDeviceTrackers() {
  cfg.adbHosts.forEach(function (adbHost) {
    _initDeviceTracker(adbHost);
  });

  setInterval(function () {
    devAry.forEach(function (dev) {
      dev.status === 'OK' && !Object.keys(dev.adbConMap).length && fastAdbExec('[KeepAlive]', dev, 'a=', {timeout: cfg.adbEchoTimeout * 1000});
    });
  }, cfg.adbKeepDeviceAliveInterval * 1000);

  setInterval(function () {
    devAry.forEach(function (dev) {
      dev.isOsStartingUp && prepareDevice(dev);
    });
  }, cfg.adbRetryPrepareDeviceInterval * 1000);

  function _initDeviceTracker(adbHost) {
    var adbCon = fastAdbExec('[TrackDevices]', adbHost, 'track-devices', function/*on_close*/() {
      adbCon.__on_adb_stream_data(EMPTY_BUF);
      setTimeout(function () {
        _initDeviceTracker(adbHost);
      }, cfg.adbRetryDeviceTrackerInterval * 1000);
    });
    adbCon.__on_adb_stream_data = function (buf) {
      var devList = [];
      buf.toString().split('\n').forEach(function (desc) { //noinspection JSValidateTypes
        if ((desc = desc.split('\t')).length !== 2 || desc[0] === '????????????' || !desc[1]) return;
        var dev = devList[devList.length] = createDev(/*conId*/desc[0], /*connectionStatus*/desc[1], adbHost);
        if (createDev.statusChanged) {
          log('[TrackDevices] ' + dev.id, dev.connectionStatus/*desc[1]*/ === REALLY_USABLE_STATUS ? 'connected' : ('status changed to: ' + dev.connectionStatus));
          dev.connectionStatus === REALLY_USABLE_STATUS ? prepareDevice(dev) : unprepareDevice(dev, 'device unusable');
        }
      });
      devAry.forEach(function (dev) {
        if (dev.adbHost === adbHost && dev.connectionStatus && devList.indexOf(dev) < 0) {
          log('[TrackDevices] ' + dev.id, 'disconnected');
          dev.connectionStatus = ''; //means disconnected
          unprepareDevice(dev, 'device disconnected');
        }
      });
    }; //end of __on_adb_stream_data
  } //end of _trackDevices
} //end of trackDevices

function unprepareDevice(dev, reason) {
  forEachValueIn(dev.adbConMap, function (adbCon) {
    adbCon.__cleanup(reason);
  });
  dev.capture && dev.capture.__cleanup(reason);
  dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.__cleanup(reason);
  dev.status = dev.touchStatus = '';
  dev.isOsStartingUp = false;
  scheduleUpdateWholeUI();
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

function prepareDevice(dev, force/*optional*/) {
  if ((dev.status === 'OK' && !force || dev.status === 'preparing')) return;
  log('[Prepare ' + dev.id + ']', 'BEGIN');
  (dev.status = 'preparing') && scheduleUpdateWholeUI();
  fastAdbExec('[CheckBasicInfo]', dev, cmd_getBaseInfo + (force ? ' rm -r ' + cfg.androidWorkDir + ' 2>/dev/null;' : ''), function/*on_close*/(stderr, stdout) {
    if (stderr) {
      return setStatus(stderr);
    }
    var parts = stdout.trim().split(/\s*===\s*/);
    if (parts.length !== 3) {
      return setStatus('failed to check device basic info');
    }
    dev.CrCount = Math.max(0, stdout.match(/\r?\r?\n$/)[0].length - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/); //in unix/linux this will be 0
    dev.info = parts[0].split(/\r*\n/);
    dev.sysVer = Number((dev.info[2] + '.0.0').split('.').slice(0, 3).join('.').replace(/\.([^.]+)$/, '$1')); //4.1.2 -> 4.12
    dev.armv = parseInt(dev.info[3].replace(/^armeabi-v|^arm64-v/, '')) >= 7 ? 7 : 5; //armeabi-v7a -> 7
    /^.+:\d+$//*wifi ip:port*/.test(dev.conId) && dev.info[4] && (dev.sn = dev.info[4]) && setDevId(dev);

    chkTouchDev(dev, parts[1]);

    if (!force && parts[2] === fileVer) {
      return finishPrepare();
    }
    return spawn('[PushFile ' + dev.id + ']', cfg.adb, ['-H', dev.adbHost.host, '-P', dev.adbHost.port, '-s', dev.conId, 'push', cfg.binDir, cfg.androidWorkDir], function/*on_close*/(stderr) {
      if ((stderr = stderr.replace(/push: .*|\d+ files pushed.*|.*KB\/s.*/g, '').replace(/\r*\n/g, ''))) {
        return setStatus(stderr);
      }
      return finishPrepare();
    }, {timeout: cfg.adbPushFileToDeviceTimeout * 1000}); //end of PushFileToDevice
  }, {timeout: cfg.adbCheckBasicInfoTimeout * 1000, log: true}); //end of CheckBasicInfo

  function setStatus(status) {
    log('[Prepare ' + dev.id + ']', 'END: ' + status);
    dev.info && (dev.info_htm = htmlEncode(dev.info[0]/*manufacturer*/ + ' ' + dev.info[1]/*model*/ + ' ' + dev.info[2]/*release*/ + ' ' + ((dev.info[3] === 'armeabi-v7a' || dev.info[3] === 'arm64-v7a') ? '' : dev.info[3])
    + (dev.cpuCount === undefined ? '' : ' ' + dev.cpuCount + 'c') + (dev.memSize === undefined ? '' : ' ' + (dev.memSize / 1000).toFixed() + 'm') + (!dev.disp ? '' : ' ' + dev.disp.w + 'x' + dev.disp.h)));
    (dev.status = status) && scheduleUpdateWholeUI();
  }

  function finishPrepare() {
    fastAdbExec('[FinishPrepare]', dev, cmd_getExtraInfo.replace('$FILE_VER', fileVer) + (dev.sysVer >= 5 ? cmd_getExtraInfo_Rest_500 : cmd_getExtraInfo_Rest), function/*on_close*/(stderr, stdout) {
      if (stderr) {
        return setStatus(stderr);
      }
      var parts = stdout.trim().split(/\s*===\s*/);
      if (parts.length !== 6 || parts[0]) {
        return setStatus('failed to finish preparing device file');
      } else if (!getMoreInfo(dev, parts)) {
        return setStatus('failed to ' + (!dev.libPath ? 'check internal lib' : !dev.disp ? 'check display size' : '?'));
      }
      setDeviceOrientation(dev, 'free');
      return setStatus('OK');
    }, {timeout: cfg.adbFinishPrepareFileTimeout * 1000, log: true});
  } //end of finishPrepare

  function getMoreInfo(dev, ary/*result of cmd_getExtraInfo*/) {
    dev.isOsStartingUp = (ary[1] === "Can't find service: window");
    (ary[1] = ary[1].match(/([1-9]\d\d+)\D+([1-9]\d\d+)/)) && (dev.disp = {w: Math.min(ary[1][1], ary[1][2]), h: Math.max(ary[1][1], ary[1][2])}) && [1, 2, 4, 5, 6, 7].forEach(function (i) {
      dev.disp[i] = {w: Math.ceil(dev.disp.w * i / 8 / 2) * 2, h: Math.ceil(dev.disp.h * i / 8 / 2) * 2};
    });
    dev.cpuCount = Number(ary[2]) || 1;
    (ary[3] = ary[3].match(/\d+/)) && (dev.memSize = Number(ary[3][0]));
    dev.libPath = ary[4].split(/\r*\n/).sort().pop();
    dev.fastLibPath = ary[5].split(/\r*\n/).sort().pop();
    return dev.libPath && dev.disp;
  }

  function chkTouchDev(dev, stdout) {
    dev.touch.modernStyle = stdout.indexOf('INPUT_PROP_DIRECT') >= 0;
    dev.touchStatus = stdout.split(/add device \d+: /).some(function (devInfo) {
      var match = {};
      if ((match['0035'] = devInfo.match(/\D*0035.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_X*/ && (match['0036'] = devInfo.match(/\D*0036.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_Y*/) {
        if ((dev.touch.modernStyle && devInfo.indexOf('INPUT_PROP_DIRECT') >= 0) || (!dev.touch.modernStyle && !devInfo.match(/\n +name: +.*pen/))) {
          dev.touch.w = Math.floor((Number(match['0035'][1]) + 1) / 2) * 2;
          dev.touch.h = Math.floor((Number(match['0036'][1]) + 1) / 2) * 2;
          if (!dev.touch.w || !dev.touch.h) {
            log('[CheckTouchDev ' + dev.id + ']', 'strange: max_x=' + match['0035'][1] + ' max_y=' + match['0036'][1]);
          } else {
            match['0030'] = devInfo.match(/\D*0030.*value.*min.*max\D*(\d+)/) || {1: 32}; //ABS_MT_TOUCH_MAJOR
            match['0039'] = devInfo.match(/\D*0039.*value.*min.*max\D*(\d+)/) || {1: 1}; //ABS_MT_TRACKING_ID
            dev.touch.avgContactSize = Math.max(Math.ceil(match['0030'][1] / 2), 1);
            dev.touch.maxTrackId = Number(match['0039'][1]);
            (match['003a'] = devInfo.match(/\D*003a.*value.*min.*max\D*(\d+)/)) && (dev.touch.avgPressure = Math.max(Math.ceil(match['003a'][1] / 2), 1)); //ABS_MT_PRESSURE
            (match['0032'] = devInfo.match(/\D*0032.*value.*min.*max\D*(\d+)/)) && (dev.touch.avgFingerSize = Math.max(Math.ceil(match['0032'][1] / 2), 1)); //ABS_MT_WIDTH_MAJOR
            dev.touch.needBtnTouchEvent = /\n +KEY.*:.*014a/.test(devInfo); //BTN_TOUCH for sumsung devices
            dev.touch.devPath = devInfo.match(/.*/)[0]; //get first line: /dev/input/eventN
            return true;
          }
        }
      }
      return false;
    }) ? 'OK' : 'touch device not found';
    log('[CheckTouchDev ' + dev.id + ']', dev.touchStatus + ' ' + (dev.touchStatus === 'OK' ? JSON.stringify(dev.touch) : ''));
  } //end of chkTouchDev
} //end of prepareDevice

function sendTouchEvent(dev, _type, _x, _y) {
  if (!chkDev(dev, {connected: true, capturing: true, touchable: true})
      || !chk('type', _type, ['d', 'm', 'u', 'o'])
      || !chk('x', _x, 0, 1) && chk('y', _y, 0, 1)) {
    return false;
  }
  var touch = dev.touch, touchSrv = dev.capture.touchSrv, x = (_x * touch.w).toFixed(), y = (_y * touch.h).toFixed(), isStart = _type === 'd', isEnd = _type === 'u' || _type === 'o', isMove = _type === 'm';
  if (isMove && touchSrv.__last_x === x && touchSrv.__last_y === y) return true; //ignore move event if at same position
  if (touch.maxTrackId === 65535) { //normal case
    if (isStart) { //down
      touchSrv.__sendEvent(3, 0x39, 0); //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
      touch.needBtnTouchEvent && touchSrv.__sendEvent(1, 0x014a, 1); //BTN_TOUCH DOWN for sumsung devices
      touchSrv.__sendEvent(3, 0x30, touch.avgContactSize); //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
      if (touch.avgPressure) {
        touchSrv.__sendEvent(3, 0x3a, touch.avgPressure); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
      } else if (touch.avgFingerSize) {
        touchSrv.__sendEvent(3, 0x32, touch.avgFingerSize); //ABS_MT_WIDTH_MAJOR 0x32 /* Major axis of approaching ellipse */
      }
      touchSrv.__sendEvent(3, 0x35, x); //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
      touchSrv.__sendEvent(3, 0x36, y); //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
    } else if (isMove) { //move
      x !== touchSrv.__last_x && touchSrv.__sendEvent(3, 0x35, x); //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
      y !== touchSrv.__last_y && touchSrv.__sendEvent(3, 0x36, y); //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
    } else { //up, out
      touchSrv.__sendEvent(3, 0x39, -1); //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
      touch.needBtnTouchEvent && touchSrv.__sendEvent(1, 0x014a, 0);  //BTN_TOUCH UP for sumsung devices
    }
    touchSrv.__sendEvent(0, 0, 0); //SYN_REPORT
  }
  else { //for some old devices such as galaxy SC-02B (android 2.2, 2.3)
    touchSrv.__sendEvent(3, 0x39, 0); //ABS_MT_TRACKING_ID 0x39 /* Unique ID of initiated contact */
    touchSrv.__sendEvent(3, 0x35, x); //ABS_MT_POSITION_X 0x35 /* Center X ellipse position */
    touchSrv.__sendEvent(3, 0x36, y); //ABS_MT_POSITION_Y 0x36 /* Center Y ellipse position */
    if (isStart || isMove) { //down, move
      touchSrv.__sendEvent(3, 0x30, touch.avgContactSize); //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
      touch.avgPressure && touchSrv.__sendEvent(3, 0x3a, touch.avgPressure); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
    } else { //up, out
      touchSrv.__sendEvent(3, 0x30, 0); //ABS_MT_TOUCH_MAJOR 0x30 /* Major axis of touching ellipse */
      touch.avgPressure && touchSrv.__sendEvent(3, 0x3a, 0); //ABS_MT_PRESSURE 0x3a /* Pressure on contact area */
    }
    touchSrv.__sendEvent(0, 2, 0); //SYN_MT_REPORT   this is very important
    if (touch.needBtnTouchEvent && (isStart || isEnd)) {
      touchSrv.__sendEvent(1, 0x014a, (isStart ? 1 : 0)); //BTN_TOUCH DOWN for sumsung devices
    }
    touchSrv.__sendEvent(0, 0, 0); //SYN_REPORT
  }
  if (isStart || isMove) { //down, move
    touchSrv.__last_x = x;
    touchSrv.__last_y = y;
  }
  return true;
}
function sendKeybdEvent(dev, keyCodeOrText, isKeyCode) {
  if (!chkDev(dev, {connected: true, capturing: true, keybdable: true})
      || isKeyCode && !keyNameMap[keyCodeOrText] && (chk.err = '`keyCode`: must be in ' + JSON.stringify(Object.keys(keyNameMap)) )
      || !isKeyCode && !chk('text', keyCodeOrText)) {
    return false;
  }
  if (isKeyCode) {
    dev.capture.keybdSrv.__runCmd('k ' + keyCodeOrText);
  } else {
    keyCodeOrText.slice(0, 2000).split(/\r*\n/).forEach(function (ls, n) {
      n && dev.capture.keybdSrv.__runCmd('k ' + 66/*enter*/);
      for (var i = 0; i < ls.length; i += 10) {
        dev.capture.keybdSrv.__runCmd('K ' + ls.slice(i, i + 10).replace(/\t/g, '%s%s%s%s').replace(/[\x00-\x20\s]/g, '%s').replace(/([\\*?$'"><|&;{}!\[\]()`~#])/g, '\\$1'));
      }
    });
  }
  return true;
}
function setDeviceOrientation(dev, orientation) {
  if (!chkDev(dev, {connected: true, capturing: true})
      || !chk('orientation', orientation, ['landscape', 'portrait', 'free'])) {
    return false;
  }
  dev.adbCon_setDeviceOrientation && dev.adbCon_setDeviceOrientation.__cleanup('new request comes');
  return (dev.adbCon_setDeviceOrientation = fastAdbExec('[SetOrientation]', dev, 'cd ' + cfg.androidWorkDir + '; ls -d /data/data/jp.sji.sumatium.tool.screenorientation >/dev/null 2>&1 || (pm install ./ScreenOrientation.apk 2>&1 | ./busybox grep -Eo \'^Success$|INSTALL_FAILED_ALREADY_EXISTS\') && am startservice -n jp.sji.sumatium.tool.screenorientation/.OrientationService -a ' + orientation + (dev.sysVer >= 4.22 ? ' --user 0' : ''), function/*on_close*/() {
    dev.adbCon_setDeviceOrientation = null;
  }, {timeout: cfg.adbSetOrientationTimeout * 1000}));
}
function turnOnScreen(dev) {
  if (!chkDev(dev, {connected: true})) {
    return false;
  }
  dev.adbCon_turnOnScreen && dev.adbCon_turnOnScreen.__cleanup('new request comes');
  return (dev.adbCon_turnOnScreen = fastAdbExec('[TurnScreenOn]', dev, 'dumpsys power | ' + (dev.sysVer >= 4.22 ? 'grep' : cfg.androidWorkDir + ' /busybox grep') + ' -q ' + (dev.sysVer >= 4.22 ? 'mScreenOn=false' : 'mPowerState=0') + ' && input keyevent 26 && input keyevent 82', function/*on_close*/() {
    dev.adbCon_turnOnScreen = null;
  }, {timeout: cfg.adbTurnScreenOnTimeout * 1000}));
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
  if (dev && !chkDev(dev, {connected: true, capturable: true})
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
      dev.capture.__cleanup('incompatible capture requested'); //stop incompatible capture process immediately if necessary

    if (!forRecording && req.headers.cookie && (q._lastViewId = req.headers.cookie.match(dev.re_lastViewId_cookie)) && (q._lastViewId = q._lastViewId[1]))
      forEachValueIn(dev.consumerMap, function (res) {
        (res.q.timestamp === q._lastViewId) && endCaptureConsumer(res);
      });

    q._promise_q = dev.capture ? dev.capture.q : q;
  }
  return true;
}
function _startNewCaptureProcess(dev, q) {
  var capture = dev.capture = {q: q, __cleanup: cleanup}, bufAry = [], foundMark = false;
  var adbCon = capture.adbCon = fastAdbExec('[CAP]', dev, '{ date >&2 && cd ' + cfg.androidWorkDir
      + ' && export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.' + (cfg.logFfmpegDebugInfo ? ' && export ASC_LOG_ALL=1' : '') + ' && export ASC_=' + encryptSn(dev.info[4]/*internalSN*/)
      + ' && exec ./ffmpeg.armv' + dev.armv + (dev.sysVer >= 5 ? '.pie' : '') + ' -nostdin -nostats -loglevel ' + (cfg.logFfmpegDebugInfo ? 'debug' : 'error')
      + ' -f androidgrab -probesize 32'/*min bytes for check*/ + (q._reqSz ? (' -width ' + q._reqSz.w + ' -height ' + q._reqSz.h) : '') + ' -i ' + (q.fastCapture ? dev.fastLibPath : dev.libPath)
      + (q._filter ? (' -vf \'' + q._filter + '\'') : '') + ' -f mjpeg -q:v 1 - ; } 2>' + cfg.androidLogPath // "-" means stdout
      , function/*on_close*/(stderr) {
        cleanup(stderr || 'CLOSED');
      }, {log: true});
  adbCon.__on_adb_stream_data = function (buf) {
    convertCRLFToLF(capture/*context*/, dev.CrCount, buf).forEach(function (buf) {
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

  capture.touchSrv = fastAdbOpen('[TouchSrv ' + dev.id + ']', dev, 'dev:' + dev.touch.devPath, function/*on_close*/() {
    capture.touchSrv = null;
  }, {log: true});
  capture.touchSrv.__sendEvent = function (type, code, value) {
    touchEventBuf.writeUInt16LE(type, 8, /*noAssert:*/true);
    touchEventBuf.writeUInt16LE(code, 10, /*noAssert:*/true);
    touchEventBuf.writeInt32LE(value, 12, /*noAssert:*/true);
    cfg.logAllProcCmd && log(capture.touchSrv.__tag + '<', 'T ' + type + ' ' + code + ' ' + value);
    capture.touchSrv.write(touchEventBuf);
  };

  capture.keybdSrv = fastAdbOpen('[KeybdSrv ' + dev.id + ']', dev, 'shell:', function/*on_close*/() {
    capture.keybdSrv = null;
  }, {log: true});
  capture.keybdSrv.__on_adb_stream_open = function () {
    capture.keybdSrv.__runCmd('exec 2> /dev/null > /dev/null');
    capture.keybdSrv.__runCmd(cfg.androidWorkDir + '/busybox stty -echo -onlcr; PS1=');
    capture.keybdSrv.__runCmd('alias k="/system/bin/input keyevent"; alias K=' + cfg.androidWorkDir + '/input_text.sh');
  };
  capture.keybdSrv.__runCmd = function (cmd) {
    cfg.logAllProcCmd && log(capture.keybdSrv.__tag + '<', cmd);
    capture.keybdSrv.write(cmd + '\n');
  };
  capture.keybdSrv.__on_adb_stream_data = function (buf) {
    cfg.logAllProcCmd && log(capture.keybdSrv.__tag, '> ' + JSON.stringify(buf.toString()));
  };

  function cleanup(reason) {
    if (cleanup.called) return;
    cleanup.called = true;
    forEachValueIn(dev.consumerMap, endCaptureConsumer);
    clearTimeout(dev.capture.delayKillTimer);
    clearInterval(dev.capture.timer_resentImageForSafari);
    clearInterval(dev.capture.timer_resentUnchangedImage);
    dev.capture.adbCon && dev.capture.adbCon.__cleanup(reason);
    dev.capture.touchSrv && dev.capture.touchSrv.__cleanup('capturer closed');
    dev.capture.keybdSrv && dev.capture.keybdSrv.__cleanup('capturer closed');
    dev.capture = null;
    forEachValueIn(dev.rdcWebSocketMap, function (rdcWebSocket) {
      delete rdcWebSocket.devHandleMap[dev.i];
      !Object.keys(rdcWebSocket.devHandleMap).length && rdcWebSocket.__cleanup('capturer closed');
    });
    dev.rdcWebSocketMap = {};
    scheduleUpdateLiveUI();
  }
}
function doCapture(dev, res/*Any Type Output Stream*/, q) {
  !dev.capture && _startNewCaptureProcess(dev, q);
  dev.consumerMap[res.__tag] = res;
  scheduleUpdateLiveUI();
  clearTimeout(dev.capture.delayKillTimer);
  res.q = q;
  res.once('close', function () {
    endCaptureConsumer(res);
  });
  res.setHeader && res.setHeader('Content-Type', q.type === 'ajpg' ? 'multipart/x-mixed-replace;boundary=MULTIPART_BOUNDARY' : 'image/jpeg');
  res.setHeader && q.type === 'ajpg' && res.setHeader('Set-Cookie', cookie_id_head + 'viewId_' + dev.var + '=' + q.timestamp + '; HttpOnly');
  res.setHeader/*http*/ && q.type === 'ajpg' && (res.__statTimer = setInterval(function () {
    res.output.length >= 30 && !res.__didResend && (res.__framesDropped = 28) && (res.output.length = res.outputEncodings.length = res.output.length - res.__framesDropped);
    (cfg.logFpsStatistic || res.__framesDropped) && log(res.__tag + ' ' + dev.capture.adbCon.__tag, 'statistics: Fps=' + ((res.__framesWritten || 0) / cfg.fpsStatisticInterval).toPrecision(3) + (res.__framesDropped ? ' dropped frames: ' + res.__framesDropped : ''));
    res.__framesWritten = res.__framesDropped = 0;
  }, cfg.fpsStatisticInterval * 1000));
  q.fastCapture && dev.capture.image && (res.setHeader && q.type === 'ajpg') && writeMultipartImage(res, dev.capture.image.buf);
  q.type === 'jpg' && dev.capture.image && endCaptureConsumer(res, dev.capture.image.buf);
  q.type === 'jpg' && dev.capture.image && dev.capture.q !== q && clearTimeout(status.updateLiveUITimer); //remove unnecessary update if not new capture process
}
function doRecord(dev, q/*same as capture*/) {
  var filename = querystring.escape(dev.sn) + '~rec_' + q._promise_q._hash + '_' + q.timestamp + '.mp4', outPath = cfg.outputDir + '/' + filename;
  var childProc = spawn('[REC ' + dev.id + ']', cfg.ffmpeg, [].concat(
      '-y' /*overwrite output*/, '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
      '-f', 'mjpeg', '-r', cfg.videoFileFrameRate, '-i', '-'/*stdin*/, '-pix_fmt', 'yuv420p'/*for safari mp4*/, outPath
  ), function/*on_close*/() {
    dev.subOutputDir && fs.link(outPath, cfg.outputDir + '/' + dev.subOutputDir + '/' + filename, function (e) {
      e && log('[REC ' + dev.id + ']', 'failed to create dir link. ' + e);
    });
  }, {stdio: ['pipe'/*stdin*/, 'ignore'/*stdout*/, 'pipe'/*stderr*/]});
  childProc.stdin.on('error', function (e) {
    !childProc.__cleanup.called && log(childProc.__tag, e);
  });
  childProc.stdin.__feedConvertTimer = setInterval(function () {
    dev.capture.image && childProc.stdin.write(dev.capture.image.buf);
  }, 1000 / cfg.videoFileFrameRate);
  childProc.stdin.__recordTimer = setTimeout(function () {
    log(childProc.__tag, 'reach recording time limit: ' + cfg.maxRecordTime);
    endCaptureConsumer(childProc.stdin);
  }, cfg.maxRecordTime * 1000);
  childProc.stdin.__tag = REC_TAG;
  doCapture(dev, childProc.stdin, q);
  return 'OK: ' + filename;
}
function endCaptureConsumer(res/*Any Type Output Stream*/, imageBuf/*optional*/) {
  var dev = devAry[res.q._dev_i];
  if (dev.consumerMap[res.__tag] !== res) return;
  delete dev.consumerMap[res.__tag];
  scheduleUpdateLiveUI();
  end(res, imageBuf);
  clearTimeout(res.__recordTimer);
  clearInterval(res.__statTimer);
  clearInterval(res.__feedConvertTimer);
  !Object.keys(dev.consumerMap).length && (dev.capture.delayKillTimer = setTimeout(function () {
    dev.capture.__cleanup('no more consumer');
  }, cfg.adbCaptureExitDelayTime * 1000));
}

function scheduleUpdateLiveUI() {
  if (Object.keys(status.consumerMap).length) {
    clearTimeout(status.updateLiveUITimer);
    status.updateLiveUITimer = setTimeout(function () {
      var sd = {}, json;
      devAry.forEach(function (dev) {
        if (dev.connectionStatus || cfg.showDisconnectedDevices) {
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

function replaceComVar(html, dev) {
  return html.replace(/@device\b/g, querystring.escape(dev.id)).replace(/#device\b/g, htmlEncode(dev.id)).replace(/\$device\b/g, dev.var).replace(/#adbArgs\b/g, htmlEncode(JSON.stringify(dev.adbHost && ['-H', dev.adbHost.host, '-P', dev.adbHost.port, '-s', dev.conId] || '')))
      .replace(/@accessKey\b/g, querystring.escape(dev.accessKey.slice(11))).replace(/#accessKey\b/g, htmlEncode(dev.accessKey.slice(11))).replace(/#devInfo\b/g, dev.info_htm).replaceShowIf('devInfo', dev.info_htm)
}
String.prototype.replaceShowIf = function (placeHolder, show) {
  return this.replace(new RegExp('@showIf_' + placeHolder + '\\b', 'g'), show ? '' : 'display:none').replace(new RegExp('@hideIf_' + placeHolder + '\\b', 'g'), show ? 'display:none' : '');
};

function web_handler(req, res) {
  res.setHeader('Content-Type', 'text/plain'); //no writeHead. This just give a chance of being changed later. statusCode is default 200.
  if (req.url.length > 8 * 1024 || req.method !== 'GET') {
    return end(res);
  }
  var parsedUrl = Url.parse(req.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname;
  var streamWeb_handler = streamWeb_handlerMap[urlPath], handler = streamWeb_handler || (req.connection.server || req.connection.socket && req.connection.socket.server) === adminWeb && adminWeb_handlerMap[urlPath];
  if (!handler) {
    return end(res);
  }
  cfg.adminKey && !q.adminKey && req.headers.cookie && (q.adminKey = req.headers.cookie.match(re_adminKey_cookie)) && (q.adminKey = querystring.unescape(q.adminKey[1]));
  if (handler !== streamWeb_handler && cfg.adminKey && cfg.adminKey !== q.adminKey) {
    return end(res, htmlCache['/login.html'], 'text/html');
  }
  if (handler.length >= 5/*up to dev arg*/ && !getDev(q, {chkAccessKey: handler === streamWeb_handler})) {
    return end(res, chk.err);
  }
  res.__log = cfg.logAllHttpReqRes || (handler.option && (handler.option.log || handler.option.logCondition && handler.option.logCondition(req, res, q)));
  res.__log && log((res.__tag = '[HTTP_' + (++httpSeq) + ']'), 'REQ: ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (' [from ' + getHttpSourceAddresses(req) + ']').replace(' [from localhost]', '') + (cfg.logHttpReqDetail ? ' [' + req.headers['user-agent'] + ']' : ''));
  res.__log && res.once('close', function () {
    log(res.__tag, 'CLOSED') && (res.__log = false);
  });
  res.on('error', function (e) { //i have never been here
    res.__log && log(res.__tag, e);
  });

  return handler(req, res, q, urlPath, devAry[q._dev_i]);
}

(streamWeb_handlerMap['/capture'] = function (req, res, q, urlPath, dev) {
  if (!chkCaptureParameter(dev, req, q, /*force_ajpg:*/false)) {
    return end(res, chk.err);
  }
  q._isSafari = /Safari/i.test(req.headers['user-agent']) && !/Chrome/i.test(req.headers['user-agent']);
  return doCapture(dev, res, q);
}).option = {
  logCondition: function (req, res, q) {
    return !(q.type === 'jpg' && q.timestamp);
  }
};
(streamWeb_handlerMap['/saveImage'] = function (req, res, q, urlPath, dev) {
  if (!cfg.enableGetFileFromStreamWeb && cfg.adminKey && q.adminKey !== cfg.adminKey && dev.re_lastViewId_cookie.test(req.headers.cookie) && (chk.err = 'access denied')
      || !chkDev(dev, {connected: true, capturing: true})) {
    return end(res, chk.err);
  }
  q.filename = querystring.escape(dev.sn) + '~live_' + dev.capture.q._hash + '_' + dev.capture.q.timestamp + '~frame' + String.fromCharCode(65 + String(dev.capture.image.i).length - 1) + dev.capture.image.i + '.jpg';
  fs.writeFile(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, dev.capture.image.buf, function (e) {
    e ? log('[SaveImage ' + dev.id + ']', e) : (dev.subOutputDir && fs.link(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, cfg.outputDir + '/' + q.filename, function (e) {
      e && log('[SaveImage ' + dev.id + ']', 'failed to create file link. ' + e);
    }));
  });
  return end(res, 'OK: ' + q.filename);
}).option = {log: true};
streamWeb_handlerMap['/touch'] = function (req, res, q, urlPath, dev) {
  end(res, sendTouchEvent(dev, q.type, Number(q.x), Number(q.y)) ? 'OK' : chk.err);
};
streamWeb_handlerMap['/sendKey'] = function (req, res, q, urlPath, dev) {
  end(res, sendKeybdEvent(dev, q.keyCode, /*isKeyCode:*/true) ? 'OK' : chk.err);
};
streamWeb_handlerMap['/sendText'] = function (req, res, q, urlPath, dev) {
  end(res, sendKeybdEvent(dev, q.text, /*isKeyCode:*/false) ? 'OK' : chk.err);
};
(streamWeb_handlerMap['/turnOnScreen'] = function (req, res, q, urlPath, dev) {
  end(res, turnOnScreen(dev) ? 'OK' : chk.err);
}).option = {log: true};
(streamWeb_handlerMap['/setOrientation'] = function (req, res, q, urlPath, dev) {
  end(res, setDeviceOrientation(dev, q.orientation) ? 'OK' : chk.err);
}).option = {log: true};
streamWeb_handlerMap['/liveViewer.html'] = function (req, res, q, urlPath, dev) {
  if (!chkCaptureParameter(dev, req, q, /*force_ajpg:*/true)) {
    return end(res, chk.err);
  }
  return end(res, replaceComVar(htmlCache[urlPath], dev).replaceShowIf('masterMode', dev.masterMode)
          .replace(/@size\b/g, q._old.size || '').replace(/@orient\b/g, q._old.orient || '').replace(/@fastResize\b/g, q._old.fastResize || '').replace(/@fastCapture\b/g, q._old.fastCapture || '')
          .replace(/@res_size\b/g, q._promise_q.size).replace(/@res_orient\b/g, q._promise_q.orient).replace(/@res_fastCapture\b/g, q._promise_q.fastCapture).replace(/@res_fastResize\b/g, q._promise_q.fastResize)
          .replace(/checkedIf_res_fastCapture\b/g, q._promise_q.fastCapture ? 'checked' : '').replace(/checkedIf_res_fastResize\b/g, q._promise_q.fastResize ? 'checked' : '')
          .replace(/enabledIf_can_fastCapture\b/g, dev.fastLibPath ? '' : 'disabled').replace(/enabledIf_can_fastResize\b/g, !!dev.fastLibPath || dev.libPath >= './sc-400' ? '' : 'disabled')
          .replace(/__server_using_websocket\b/g, websocket ? 'true' : 'false')
      , 'text/html');
};
streamWeb_handlerMap['/videoViewer.html'] = streamWeb_handlerMap['/imageViewer.html'] = function (req, res, q, urlPath, dev) {
  if (!cfg.enableGetFileFromStreamWeb && cfg.adminKey && q.adminKey !== cfg.adminKey && (chk.err = 'access denied')) {
    return end(res, chk.err);
  }
  return fs.readdir(cfg.outputDir, function (e, filenameAry) {
    if (e) {
      return end(res, String(e));
    }
    var filenameMap = {/*sortKey:*/}, isImage = (urlPath === '/imageViewer.html');
    filenameAry.forEach(function (f) {
      (f = new FilenameInfo(f, dev.sn)).isValid && isImage === (f.type === 'jpg') && (filenameMap[f.timestamp + (f.i || '')] = f);
    });
    var sortedKeys = Object.keys(filenameMap).sort().reverse();
    if (!isImage) { //videoViewer
      if (!(q.filename = filenameMap[sortedKeys[q.fileindex = Number(q.fileindex) || 0]])) {
        return end(res, sortedKeys.length ? '`fileindex`: out of range' : 'file not found');
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
            return sortedKeys.slice(0, Number(q.count) || cfg.defaultMaxRecentImageFiles).reduce(function (joinedStr, key) {
              return joinedStr + htmlBlock.replace(/@filename\b/g, querystring.escape(filenameMap[key]));
            }, ''/*initial joinedStr*/);
          }), 'text/html');
    }
  });
};
streamWeb_handlerMap['/getFile'] = function (req, res, q, urlPath, dev) {
  if (!cfg.enableGetFileFromStreamWeb && cfg.adminKey && q.adminKey !== cfg.adminKey && (chk.err = 'access denied')
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
      .once('error', function (e) {
        end(res, String(e));
      }).pipe(res);
};
streamWeb_handlerMap['/common.js'] = streamWeb_handlerMap['/jquery.js'] = streamWeb_handlerMap['/common.css'] = function (req, res, q, urlPath) {
  end(res, htmlCache[urlPath], Path.extname(urlPath) === 'js' ? 'text/javascript' : 'text/css');
};

(adminWeb_handlerMap['/deviceControl'] = function (req, res, q, urlPath, dev) {
  if (!!chkDev(q, {connected: true})
      || (q.action = q.action === 'setAccessKey' ? '' : q.action) && !chk('action', q.action, ['startRecording', 'stopRecording', 'stopLiveView'])
      || q.action === 'startRecording' && !chkCaptureParameter(dev, req, q, /*force_ajpg:*/true, /*forRecording*/true)) {
    return end(res, chk.err);
  }
  if (q.subOutputDir !== undefined && q.subOutputDir !== dev.subOutputDir) {
    try {
      !fs.existsSync(cfg.outputDir + '/' + q.subOutputDir) && fs.mkdirSync(cfg.outputDir + '/' + q.subOutputDir);
    } catch (e) {
      return end(res, String(e));
    }
    dev.subOutputDir = q.subOutputDir;
  }
  if (q.accessKey !== undefined && q.accessKey !== dev.accessKey && q.accessKey !== dev.accessKey.slice(11)) {
    dev.accessKey = (dev.masterMode = !!q.accessKey) ? (getTimestamp().slice(4, 14) + '_' + q.accessKey) : newAutoAccessKey();
    dev.capture && dev.capture.__cleanup('access removed');
    dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.__cleanup('access removed');
    scheduleUpdateWholeUI();
  }
  else if (q.action) {
    forEachValueIn(dev.consumerMap, function (res) {
      if (q.action === 'stopLiveView' ? res.__tag !== REC_TAG : res.__tag === REC_TAG) endCaptureConsumer(res);
    });
    !Object.keys(dev.consumerMap).length && dev.capture && dev.capture.__cleanup('on demand'); //end capture process immediately if no any consumer exists
  }
  q.adbBridge && (dev.adbBridge = (q.adbBridge === 'true'));
  q.orientation && setDeviceOrientation(dev, q.orientation);
  return q.action === 'startRecording' ? end(res, doRecord(dev, q)) : end(res, 'OK');
}).option = {log: true};
(adminWeb_handlerMap['/prepareAllDevices' + cfg.adminUrlSuffix] = function (req, res, q) {
  devAry.forEach(function (dev) {
    dev.connectionStatus === REALLY_USABLE_STATUS && prepareDevice(dev, q.mode === 'forcePrepare');
  });
  end(res, 'OK');
}).option = {log: true};
adminWeb_handlerMap['/getWebHost'] = function (req, res) {
  end(res, JSON.stringify({adminHost: req.connection.address().address + ':' + cfg.adminWeb_port, streamHost: req.connection.address().address + ':' + cfg.streamWeb_port}), 'text/json');
};
adminWeb_handlerMap['/getAdbHost'] = function (req, res, q, urlPath, dev) {
  end(res, JSON.stringify(chkDev(dev, {connected: true}) ? {host: dev.adbHost.host, port: dev.adbHost.port, conId: dev.conId} : chk.err), 'text/json');
};
adminWeb_handlerMap['/'] = function (req, res, q) {
  q.viewUrlBase && (q.viewUrlBase = Url.parse((/^https?[:][/][/]/.test(q.viewUrlBase) ? '' : (cfg.streamWeb_protocol || cfg.adminWeb_protocol) + '://' ) + q.viewUrlBase).format());
  var html = htmlCache['/home.html'].replace(/@appVer\b/g, status.appVer).replace(/@adminUrlSuffix\b/g, cfg.adminUrlSuffix && q.adminUrlSuffix || '')
      .replace(/@viewUrlBase\//g, q.viewUrlBase || '').replace(/#viewUrlBase\b/g, htmlEncode(q.viewUrlBase || '')).replaceShowIf('isStreamWebSeparated', cfg.streamWeb_port)
      .replace(/@androidLogPath\b/g, querystring.escape(cfg.androidLogPath)).replace(/@androidWorkDir\b/g, querystring.escape(cfg.androidWorkDir))
      .replace(/@viewSize\b/g, cfg.viewSize).replace(/@viewOrient\b/g, cfg.viewOrient).replace(/@videoFileFrameRate\b/g, String(cfg.videoFileFrameRate));
  switchList.forEach(function (k) { //set enable or disable of some config buttons for /var? command
    html = html.replace(new RegExp('@' + k + '\\b', 'g'), cfg[k]).replace(new RegExp('@' + k + '_negVal\\b', 'g'), String(!cfg[k])).replace(new RegExp('checkedIf_' + k + '\\b', 'g'), cfg[k] ? 'checked' : '');
  });
  cfg.adminKey && res.setHeader('Set-Cookie', cookie_id_head + 'adminKey=' + querystring.escape(cfg.adminKey) + '; HttpOnly');
  end(res, html.replace(re_repeatableHtmlBlock, function/*createMultipleHtmlBlocks*/(wholeMatch, htmlBlock) {
    return (cfg.showDisconnectedDevices ? devAry.slice() : devAry.filter(function (dev) {
      return dev.connectionStatus;
    })).sort(function (dev1, dev2) {
          return dev1.info_htm.localeCompare(dev2.info_htm);
        }).reduce(function (joinedStr, dev, i) {
          return joinedStr + replaceComVar(htmlBlock, dev)
                  .replace(/#devErr\b/g, htmlEncode(!dev.connectionStatus ? 'no device' : dev.status === 'preparing' ? 'preparing' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? '' : dev.touchStatus) : dev.status))
                  .replace(/@devStatusClass\b/g, !dev.connectionStatus ? 'devFileOnly' : dev.status === 'preparing' ? 'devPrep' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? 'devOK' : 'devErr') : 'devErr')
                  .replace(/#accessKey_disp\b/g, htmlEncode(dev.accessKey)).replace(/@masterMode\b/g, dev.masterMode).replace(/@rowNum\b/g, String(i + 1))
        }, ''/*initial joinedStr*/);
  }), 'text/html');
};
adminWeb_handlerMap['/getServerLog' + cfg.adminUrlSuffix] = function (req, res, q) {
  q._logFilePath = log.getLogFilePath(q.logHowManyDaysAgo);
  if (!(q._fileSize = getFileSizeSync(q._logFilePath) || (q.mode && !chk('size', q.size = Number(q.size), 1, Number.MAX_VALUE)))) {
    return end(res, chk.err);
  }
  q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + Path.basename(q._logFilePath)); //remove dir part
  q.device && (res.__oldWrite = res.write) && (res.write = function (buf) {
    Buffer.concat([res.__orphanBuf, buf]).toString('binary').split(/\n/).forEach(function (s, i, lineAry) {
      (buf = (s.indexOf(q.device) >= 0 || q.qdevice && s.indexOf(q.qdevice) >= 0)) && res.__oldWrite(s + '\n', 'binary');
      i === lineAry.length - 1 && !buf && (res.__orphanBuf = new Buffer(s, 'binary'));
    });
  }) && (res.__orphanBuf = EMPTY_BUF) && (q.qdevice = querystring.escape(q.device)) === q.device && (q.qdevice = '');
  return fs.createReadStream(q._logFilePath, {
    start: q.mode === 'tail' ? Math.max(0, Math.min(q._fileSize - 1, q._fileSize - q.size)) : 0,
    end: q.mode === 'head' ? Math.max(0, Math.min(q._fileSize - 1, q.size - 1)) : (q._fileSize - 1)
  }).once('error', function (e) {
    end(res, String(e));
  }).pipe(res);
};
(adminWeb_handlerMap['/set' + cfg.adminUrlSuffix] = function (req, res, q) {
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
}).option = {log: true};
(adminWeb_handlerMap['/reloadResource' + cfg.adminUrlSuffix] = function (req, res) {
  reloadResource();
  end(res, 'OK');
}).option = {log: true};
(adminWeb_handlerMap['/cmd' + cfg.adminUrlSuffix] = function (req, res, q) {
  var dev = getDev(q, {connected: true}), restLen = (q.size = Number(q.size)) > 0 ? q.size : cfg.defaultMaxAdminCmdOutputLength;
  if (!dev) {
    end(res, chk.err);
  } else {
    var adbCon = fastAdbExec('[cmd]', dev, q.cmd, function/*on_close*/(stderr) {
      end(res, !stderr ? '' : ((res.headersSent ? '\n' : '') + stderr));
    }, {timeout: (Number(q.timeout) || cfg.adbCmdTimeout) * 1000, log: q.log !== 'false'});
    adbCon.__on_adb_stream_data = function (buf) {
      res.write(buf.slice(0, Math.min(buf.length, restLen)));
      (restLen -= buf.length) <= 0 && adbCon.__cleanup('too much output');
    };
    res.on('close', function () {
      adbCon.__cleanup('browser connection closed');
    });
  }
}).option = {
  logCondition: function (req, res, q) {
    return q.log !== 'false';
  }
};
(adminWeb_handlerMap['/stopServer' + cfg.adminUrlSuffix] = function (req, res) {
  end(res, 'OK');
  adminWeb.close();
  streamWeb && streamWeb.close();
  forEachValueIn(procMap, function (proc) {
    proc.__cleanup('on demand');
  });
  process.exit(0);
}).option = {log: true};
adminWeb_handlerMap['/status'] = function (req, res, q) {
  res.__previousVer = q.ver;
  res.__previousAppVer = q.appVer;
  status.consumerMap[res.__tag || (res.__tag = getTimestamp())] = res;
  res.once('close', function () {
    delete status.consumerMap[res.__tag];
  });
  scheduleUpdateLiveUI();
};

function createWebSocketServer() {
  new websocket.server({httpServer: (streamWeb ? [adminWeb, streamWeb] : [adminWeb]), maxReceivedFrameSize: 8 * 1024, maxReceivedMessageSize: 8 * 1024}).on('request', function (wsConReq) {
    var httpReq = wsConReq.httpRequest, httpTag = '[HTTP_' + (++httpSeq) + '] [WebSocket]';
    var parsedUrl = Url.parse(httpReq.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, dev;
    log(httpTag, 'REQ: ' + httpReq.url + (' [from ' + getHttpSourceAddresses(httpReq) + ']').replace(' [from localhost]', '') + (cfg.logHttpReqDetail ? ' [' + httpReq.headers['user-agent'] + ']' : '') + (cfg.logHttpReqDetail ? (' origin: ' + wsConReq.origin || '') : ''));
    if (urlPath === '/adbBridge') {
      if (!(dev = getDev(q, {chkAccessKey: true, connected: true, adbBridge: true}))) {
        log(httpTag, 'Rejected. Reason: ' + chk.err);
        return wsConReq.reject();
      }
      log(httpTag, 'Accepted as [ADBB ' + dev.id + ']');
      dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.__cleanup('new adbBridge is requested');
      dev.adbBridgeWebSocket = wsConReq.accept(null, wsConReq.origin);
      return handle_adbBridgeWebSocket_connection(dev, '[ADBB ' + dev.id + ']');
    }
    else if (urlPath === '/touch' || urlPath === '/sendKey' || urlPath === '/sendText') {
      if (!(dev = getDev(q, {chkAccessKey: true, connected: true}))) {
        log(httpTag, 'Rejected. Reason: ' + chk.err);
        return wsConReq.reject();
      }
      log(httpTag, 'Accepted as [RDC__' + httpSeq + ']');
      var rdcWebSocket = wsConReq.accept(null, wsConReq.origin);
      rdcWebSocket.devHandleMap = {};
      rdcWebSocket.devHandleMap[dev.i] = dev;
      dev.rdcWebSocketMap[rdcWebSocket.__id = getTimestamp()] = rdcWebSocket;
      return handle_rdcWebSocket_connection(rdcWebSocket, '[RDC__' + httpSeq + ']');
    }
    else {
      log(httpTag, 'Rejected');
      return wsConReq.reject();
    }
  });
}

var importantAdbCmdSet = {'CNXN': 1, 'OPEN': 1, 'SYNC': 1, 'AUTH': 1, 'CLSE': 1};

function handle_adbBridgeWebSocket_connection(dev, tag) {
  var ws = dev.adbBridgeWebSocket, backendMap = {/*id:*/}, nextBackendId = 0;

  ws.once('close', function (code, detail) {
    cleanup('CLOSED', (code || '') + (detail ? ' ' + detail : ''));
  });
  ws.on('error', function (e) {
    cleanup('network error', e);
  });

  ws.on('message', function (msg) {
    if (!msg.binaryData) return;
    var allBuf = ws.__recvBuf ? Buffer.concat([ws.__recvBuf, msg.binaryData]) : msg.binaryData, payloadLen;
    for (; allBuf.length >= 24 && allBuf.length >= 24 + (payloadLen = allBuf.readUInt32LE(12)); allBuf = allBuf.slice(24 + payloadLen)) {
      handle_adb_command(/*cmd:*/ allBuf.slice(0, 4).toString(), /*arg0:*/ allBuf.readUInt32LE(4), /*arg1:*/ allBuf.readUInt32LE(8), /*payloadBuf:*/ allBuf.slice(24, 24 + payloadLen));
    }
    ws.__recvBuf = allBuf;
  });

  ws.__cleanup = cleanup;

  function handle_adb_command(cmd, arg0, arg1, payloadBuf) {
    var backend = backendMap[arg1];
    (cfg.logAdbBridgeDetail || importantAdbCmdSet[cmd]) && log(tag, 'read  ' + cmd + '(' + hexUint32(arg0) + ', ' + hexUint32(arg1) + ') + ' + hexUint32(payloadBuf.length) + ' bytes' + (payloadBuf.length ? (': "' + buf2ascii(payloadBuf) + '"') : ''));

    if (cmd === 'CNXN') {
      bridge_write('CNXN', /*arg0:A_VERSION*/0x01000000, /*arg1:MAX_PAYLOAD*/0x00001000, new Buffer('device::ro.product.name=' + dev.info[5] + ';ro.product.model=' + dev.info[1] + ';ro.product.device=' + dev.info[6] + ';'));
    }
    else if (cmd === 'OPEN') {
      var serviceBuf = (payloadBuf[payloadBuf.length - 1] ? payloadBuf : payloadBuf.slice(0, -1)), total_matched_len = 0;
      arg1/*as localId*/ = (nextBackendId === 0xffffffff ? (nextBackendId = 1) : ++nextBackendId);

      backend = backend_create(/*localId:*/arg1, /*remoteId*/arg0);

      backend_write(backend, dev.buf_switchTransport);

      backend.on('data', function (buf) {
        cfg.logAdbBridgeDetail && log(backend.__tag, 'read  ' + hexUint32(buf.length) + ' bytes: "' + buf2ascii(buf) + '"');
        if (total_matched_len < 8) {
          var match_len = Math.min(buf.length, 4 - total_matched_len % 4), i;
          for (i = 0; i < match_len; i++, total_matched_len++)
            if (buf[i] !== 'OKAY'.charCodeAt(total_matched_len % 4)) return backend_cleanup(backend, 'FAIL');
          if (total_matched_len !== 4 && total_matched_len !== 8) return;

          if (total_matched_len === 4) {
            return backend_write(backend, adbHost_makeBuf(serviceBuf));
          }
          bridge_write('OKAY', /*localId:*/arg1, /*remoteId:*/arg0);

          if (!(buf = buf.slice(match_len)).length) return;
        }
        do {
          var len = Math.min(4096, buf.length);
          bridge_write('WRTE', /*localId:*/arg1, /*remoteId:*/arg0, buf.slice(0, len));
        } while ((buf = buf.slice(len)).length);
      });
    } //end of OPEN
    else {
      if (!backend) {
        backend_cleanup(backend, 'invalid backend id');
      } else if (cmd === 'WRTE') {
        backend_write(backend, payloadBuf);
        bridge_write('OKAY', /*localId:*/arg1, /*remoteId:*/arg0);
      } else if (cmd === 'CLSE') {
        backend_cleanup(backend, 'CLSE requested');
      }
    }
  } //end of handle_adb_command

  function bridge_write(cmd, arg0, arg1, payloadBuf) {
    payloadBuf = payloadBuf || EMPTY_BUF;
    cfg.logAdbBridgeDetail && log(tag, 'write ' + cmd + '(' + hexUint32(arg0) + ', ' + hexUint32(arg1) + ') + ' + hexUint32(payloadBuf.length) + ' bytes' + (cfg.logAdbBridgeDetail ? (': "' + buf2ascii(payloadBuf) + '"') : ''));
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
    ws.send(buf);
  }

  function backend_create(backendId, frontendId/*for peer id*/) {
    var tag = '[ADBH ' + dev.id + ']';
    var backend = net.connect(dev.adbHost, function () {
      cfg.logAdbBridgeDetail && log(tag, 'connection OK. ' + dev.adbHost.host + ':' + dev.adbHost.port + ' as backend ' + hexUint32(backendId));
    });

    backend.__id = backendId;
    backend.__frontendId = frontendId;
    backend.__tag = tag;
    backendMap[backendId] = backend;

    backend.once('close', function () {
      backend_cleanup(backend, 'CLOSED');
    });
    backend.on('error', function (e) {
      backend_cleanup(backend, 'network error', e);
    });

    return backend;
  }

  function backend_cleanup(backend, reason, detail) {
    if (!backend || !backendMap[backend.__id]) return;
    delete backendMap[backend.__id];
    cfg.logAdbBridgeDetail && log(backend.__tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
    reason !== 'CLOSED' && backend.end();
    reason !== 'CLSE requested' && bridge_write('CLSE', /*localId:*/0, /*remoteId:*/backend.__frontendId);
  }

  function backend_write(backend, buf) {
    cfg.logAdbBridgeDetail && log(backend.__tag, 'write ' + hexUint32(buf.length) + ' bytes: "' + buf2ascii(buf) + '"');
    backend.write(buf);
  }

  function cleanup(reason, detail) {
    if (cleanup.called) return;
    (cleanup.called = true) && reason && log(tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
    reason !== 'CLOSED' && ws.drop();

    forEachValueIn(backendMap, function (backend) {
      backend_cleanup(backend, reason, detail);
    });
    dev.adbBridgeWebSocket = null;
  }
} // end of handle_adbBridgeWebSocket_connection

function handle_rdcWebSocket_connection(ws, tag) {
  ws.once('close', function (code, detail) {
    cleanup('CLOSED', (code || '') + (detail ? ' ' + detail : ''));
  });
  ws.on('error', function (e) {
    cleanup('network error', e);
  });

  ws.on('message', function (msg) {
    var devHandle, dev;
    if (msg.type === 'utf8') {
      var match = msg.utf8Data.match(/^(\d+)([:<])([\s\S]+)$/);
      if (!match) { //treat as open_device request
        cfg.logRdcWebSocketDetail && log(tag, 'open device: ' + JSON.stringify(msg.utf8Data));
        var parsedUrl = Url.parse(msg.utf8Data, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname;
        if (!(dev = getDev(q, {chkAccessKey: true, connected: true, capturing: true, touchable: /\/?touch$/.test(urlPath), keybdable: /\/?(sendKey|sendText)$/.test(urlPath)}))) {
          return ws.send(chk.err);
        }
        ws.devHandleMap[dev.i] = dev;
        dev.rdcWebSocketMap[ws.__id] = ws;

        return ws.send(String(dev.i));
      } //end of open_device request

      dev = ws.devHandleMap[devHandle = Number(match[1])];
      var isKeyCode = match[2] === ':', keyCodeOrText = match[3];
      cfg.logRdcWebSocketDetail && log(tag + ' [' + (dev ? dev.id : '?#' + devHandle) + ']', 'input: ' + JSON.stringify(keyCodeOrText) + (isKeyCode ? ('(KeyCode ' + (keyNameMap[keyCodeOrText] || '?') + ')') : ''));
      if (!sendKeybdEvent(dev, keyCodeOrText, isKeyCode)) {
        return ws.send(chk.err);
      }
    }
    else { //binary
      if (msg.binaryData.length !== 13) {
        return ws.send('invalid request');
      }
      dev = ws.devHandleMap[devHandle = msg.binaryData.readUInt32BE(0)];
      var type = String.fromCharCode(msg.binaryData.readUInt8(12)), x = msg.binaryData.readFloatBE(4), y = msg.binaryData.readFloatBE(8);
      cfg.logRdcWebSocketDetail && log(tag + ' [' + (dev ? dev.id : '?#' + devHandle) + ']', 'touch: ' + type + ' ' + x.toFixed(5) + ' ' + y.toFixed(5));
      if (!sendTouchEvent(dev, type, x, y)) {
        return ws.send(chk.err);
      }
    }
    return ws.send(''/*OK*/);
  });

  ws.__cleanup = cleanup;

  function cleanup(reason, detail) {
    if (cleanup.called) return;
    (cleanup.called = true) && reason && log(tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
    reason !== 'CLOSED' && ws.drop();

    forEachValueIn(ws.devHandleMap, function (dev) {
      delete dev.rdcWebSocketMap[ws.__id];
    });
    ws.devHandleMap = {};
  }
} //end of handle_rdcWebSocket_connection

function reloadResource() {
  scheduleUpdateWholeUI();
  fs.readdirSync('./html').forEach(function (filename) {
    htmlCache['/' + filename] = fs.readFileSync('./html/' + filename).toString();
  });
  fs.readdirSync(cfg.outputDir).forEach(function (filename) {
    (filename = new FilenameInfo(filename)).isValid && createDev(filename.sn);
  });
  fileVer = fs.readdirSync(cfg.binDir).sort().reduce(function (hash, filename) {
    return hash.update(/^\./.test(filename) ? '' : fs.readFileSync(cfg.binDir + '/' + filename));
  }, crypto.createHash('md5')/*initial value*/).digest('hex');
}

reloadResource();
spawn('[CheckAdb]', cfg.adb, ['version'], function/*on_close*/(stderr) {
  if (stderr) {
    process.stderr.write('failed to check "Android Debug Bridge". Please install it from http://developer.android.com/tools/sdk/tools-notes.html and add path INSTALLED_DIR/platform-tools into PATH env var or set full path of adb to "adb" in config.json or your own config file\n');
    return process.exit(1);
  }
  return spawn('[CheckFfmpeg]', cfg.ffmpeg, ['-version'], function/*on_close*/(stderr) {
    stderr && process.stderr.write('failed to check FFMPEG (for this machine, not for Android device). You can not record video in H264/MP4 format.\nPlease install it from http://www.ffmpeg.org/download.html and add the ffmpeg\'s dir to PATH env var or set full path of ffmpeg to "ffmpeg" in config.json or your own config file\n');
    try {
      websocket = require('websocket');
    } catch (e) {
    }
    !websocket && process.stderr.write('failed to check websocket lib. You will not be able to use some advanced function(i.e. AdbBridge via browser, fast touch/keyboard).\nYou can install it by command "nmp install websocket" or from "https://github.com/theturtle32/WebSocket-Node"\n');
    adminWeb = cfg.adminWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync(cfg.adminWeb_cert)}, web_handler) : require('http').createServer(web_handler);
    adminWeb.listen(cfg.adminWeb_port, cfg.adminWeb_ip === '*' ? undefined/*all ip4*/ : cfg.adminWeb_ip, function/*on_httpServerReady*/() {
      if (cfg.streamWeb_port) {
        streamWeb = cfg.streamWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync(cfg.streamWeb_cert)}, web_handler) : require('http').createServer(web_handler);
        streamWeb.listen(cfg.streamWeb_port, cfg.streamWeb_ip === '*' ? undefined/*all ip4*/ : cfg.streamWeb_ip, function/*on_httpServerReady*/() {
          process.stderr.write('OK. You can start from ' + cfg.adminWeb_protocol + '://localhost:' + cfg.adminWeb_port + '/' + (cfg.adminKey ? '?adminKey=' + querystring.escape(cfg.adminKey) : '') + '\n');
          websocket && createWebSocketServer();
        });
      } else {
        process.stderr.write('OK. You can start from ' + cfg.adminWeb_protocol + '://localhost:' + cfg.adminWeb_port + '/' + (cfg.adminKey ? '?adminKey=' + querystring.escape(cfg.adminKey) : '') + '\n');
        websocket && createWebSocketServer();
      }
      initAdbHosts();
      initDeviceTrackers();
    });
  }, {timeout: 10 * 1000});
}, {timeout: 30 * 1000});
