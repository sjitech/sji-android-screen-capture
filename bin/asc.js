'use strict';
var old_work_dir = process.cwd();
process.chdir(__dirname); //set dir of current file as working dir
var child_process = require('child_process'), fs = require('fs'), Url = require('url'), querystring = require('querystring'), Path = require('path'), crypto = require('crypto'), util = require('util'), net = require('net'), os = require('os'),
  jsonFile = require('./node_modules/jsonFile.js'), logger = require('./node_modules/logger.js'),
  cfg = util._extend(jsonFile.parse('./config.json'), process.argv[2/*first param*/] && jsonFile.parse(Path.resolve(old_work_dir, process.argv[2]))), //combine user provided configuration file with base file
  log = logger.create(cfg && cfg['log_filePath'], cfg && cfg['log_keepOldFileDays']);
log('===================================pid:' + process.pid + '=======================================\nuse configuration: ' + JSON.stringify(cfg, null, '  '));
process.on('uncaughtException', function (e) {
  log('uncaughtException: ' + e + "\n" + e.stack);
  process.stderr.write(e + "\n" + e.stack + '\n');
  throw e;
});
var adminWeb, streamWeb, devGrpMap = {/*sn:*/}, devAry = [], status = {consumerMap: {/*consumerId:*/}}, htmlCache = {/*'/'+filename:*/}, procMap = {/*pid:*/}, adminWeb_handlerMap = {/*urlPath:*/}, streamWeb_handlerMap = {/*urlPath:*/}, httpSeq = 0, websocket, fileVer, pushContentMap = {/*filename:*/};
var CrLfBoundTypeCrLf2 = new Buffer('\r\n--MULTIPART_BOUNDARY\r\nContent-Type: image/jpeg\r\n\r\n');
var REC_TAG = '[REC]', EMPTY_BUF = new Buffer([]), touchEventBuf = new Buffer([/*type*/0, 0, /*code*/0, 0, /*value*/0, 0, 0, 0]);
var re_filename = /^(([^\/\\]+)~(?:live|rec)_[fF]\d+[^_]*_(\d{14}\.\d{3}(?:\.[A-Z]?\d+)?)(?:\.ajpg)?)(?:(?:\.(mp4))|(?:~frame([A-Z]?\d+)\.(jpg)))$/,
  re_size = /^0{0,3}([1-9][0-9]{0,3})x0{0,3}([1-9][0-9]{0,3})$|^0{0,3}([1-9][0-9]{0,3})x(?:Auto)?$|^(?:Auto)?x0{0,3}([1-9][0-9]{0,3})$/i,
  cookie_id_head = '_' + crypto.createHash('md5').update(os.hostname()).digest().toString('hex') + '_' + cfg.adminWeb_port + '_',
  re_adminKey_cookie = new RegExp('\\b' + cookie_id_head + 'adminKey=([^;]+)'),
  re_repeatableHtmlBlock = /<!--repeatBegin-->\s*([^\0]*)\s*<!--repeatEnd-->/g;
var switchList = ['showDisconnectedDevices', 'logFfmpegDebugInfo', 'logFpsStatistic', 'logHttpReqDetail', 'logAllProcCmd', 'logAllHttpReqRes', 'logAdbBridgeDetail', 'logAdbBridgeReceivedData', 'logRdcWebSocketDetail', 'fastResize', 'fastCapture', 'should_callAscLibSecurely', 'support_adbBridge'];
var keyCodeMapOfName = {}, keyNameMapOfCode = {
  3: 'HOME',
  4: 'BACK',
  82: 'MENU',
  26: 'POWER',
  187: 'APP_SWITCH',
  66: 'ENTER',
  67: 'DEL',
  112: 'FORWARD_DEL',
  21: 'DPAD_LEFT',
  22: 'DPAD_RIGHT',
  19: 'DPAD_UP',
  20: 'DPAD_DOWN',
  122: 'MOVE_HOME',
  123: 'MOVE_END'
};
Object.keys(keyNameMapOfCode).forEach(function (keyCode) {
  return keyCodeMapOfName[keyNameMapOfCode[keyCode]] = keyCode;
});

function spawn(tag, _path, args, _on_close/*(err, stdout, ret, signal)*/, _opt/*{stdio{}, timeout}*/) {
  var on_close = typeof(_on_close) === 'function' ? _on_close : dummyFunc, opt = (typeof(_on_close) === 'function' ? _opt : _on_close) || {}, stdout = [], err = [], timer;
  log(tag, 'SPAWN ' + JSON.stringify(_path) + ' ' + JSON.stringify(args) + (opt.timeout ? ' timeout:' + opt.timeout : ''), /*autoNewLine:*/false);

  var childProc = child_process.spawn(_path, args, opt);
  childProc.pid && (procMap[childProc.pid] = childProc);

  log(tag, childProc.pid ? ('. OK: pid_' + childProc.pid) : '. FAILED');
  childProc.__tag = tag = tag + (childProc.pid ? ' [pid_' + childProc.pid + ']' : '');

  childProc.stdout && childProc.stdout.on('data', function (buf) {
    log(tag + '>', buf, /*autoNewLine:*/false);
    on_close.length >= 2 && stdout.push(buf);
  });
  childProc.stderr && childProc.stderr.on('data', function (buf) {
    log(tag + '!', buf, /*autoNewLine:*/false);
    on_close.length >= 1 && err.push(buf);
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
    err = Buffer.concat(err).toString('binary');
    stdout = Buffer.concat(stdout).toString('binary');
    err = reason !== 'CLOSED' && reason || signal || err;
    on_close(err, stdout, code, signal);
  }
}

function adbRun(_tag, dev, cmd, _on_close/*(err, stdout)*/, _opt) {
  return adb(_tag, dev, 'shell:' + cmd, _on_close, _opt);
}

function adb(_tag, devOrHost, service, _on_close/*(err, stdout)*/, _opt) {
  var on_close = typeof(_on_close) === 'function' ? _on_close : dummyFunc, opt = (typeof(_on_close) === 'function' ? _opt : _on_close) || {}, stdout = [], err = [], timer;
  var isDevCmd = !!devOrHost.adbHost, dev = isDevCmd ? devOrHost : null, adbHost = isDevCmd ? dev.adbHost : devOrHost;
  var tag = _tag + ' {' + (isDevCmd ? dev.id : adbHost) + '} [ADB]', _log = cfg.logAllProcCmd || opt.log;
  _log && log(tag, 'OPEN ' + JSON.stringify(service) + (opt.timeout ? ' timeout:' + opt.timeout : ''));

  var adbCon = net.connect(adbHost, function /*on_connected*/() {
    (adbCon.__everConnected = true) && cfg.logAllProcCmd && log(tag, '---- connection OK');
    var total_okay_len = 0, wanted_payload_len = -1, tmpBuf = EMPTY_BUF, tmpBufAry = [];

    isDevCmd ? adbCon.write(dev.buf_switchTransport) : adbCon.write(adbHost_makeBuf(new Buffer(service)));

    adbCon.on('data', function (buf) {
      if (cleanup.called) return;
      if (err.length) return err.push(buf);
      if (total_okay_len < (isDevCmd ? 8/*len of OKAYOKAY*/ : 4/*len of OKAY*/)) {
        var okay_len = Math.min(buf.length, 4 - total_okay_len % 4), i;
        for (i = 0; i < okay_len; i++, total_okay_len++)
          if (buf[i] !== 'OKAY'.charCodeAt(total_okay_len % 4)) return err.push(buf); //"FAIL" + hexUint32(msg.byteLength) + msg
        if (total_okay_len !== 4 && total_okay_len !== 8) return;

        if (total_okay_len === 4/*len of OKAY*/ && isDevCmd) {
          return adbCon.write(adbHost_makeBuf(new Buffer(service)));
        }
        cfg.logAllProcCmd && log(tag, '---- adb stream opened');
        adbCon.__adb_stream_opened = true;
        adbCon.emit('__adb_stream_opened');

        if (!(buf = buf.slice(okay_len)).length) return;
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
            tmpBuf = new Buffer(0);
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
  isDevCmd && (dev.adbConMap[adbCon.__id = getTimestamp()] = adbCon);
  return adbCon;

  function cleanup(reason, detail) {
    if (cleanup.called) return;
    (cleanup.called = true) && _log && log(tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
    reason !== 'CLOSED' && adbCon.end();
    isDevCmd && (delete dev.adbConMap[adbCon.__id]);
    if (reason === 'network error' && !adbCon.__everConnected && adbHost.autoStartLocalAdbServer) {
      setTimeout(function () {
        spawn('[StartAdbServer]', cfg['adb'], ['-P', adbHost.port, 'start-server'], {timeout: 10 * 1000});
      }, cfg['adbAutoStartServerInterval'] * 1000);
    }
    clearTimeout(timer);
    (stdout = Buffer.concat(stdout).toString('binary')) && _log && log(tag + '>', stdout);
    (err = Buffer.concat(err).toString('binary')) && (err = err.slice(8) || err.slice(0, 4)) && _log && log(tag + '!', err);
    (stdout || err) && _log && log(tag, '---- end of output');
    on_close(reason !== 'CLOSED' && reason || err && ('error: ' + err), stdout);
  }
}

function adbHost_makeBuf(buf) {
  return Buffer.concat([new Buffer(hexUint32(buf.length)), buf]);
}

function adbPreparePushFile(content, remotePath) {
  var bufAry = [], head, body, i;
  head = new Buffer('SEND____');
  body = new Buffer(remotePath);
  head.writeUInt32LE(body.length, 4);
  bufAry.push(head, body);
  for (i = 0; i < content.length; i += 64 * 1024) {
    head = new Buffer('DATA____');
    body = content.slice(i, i + 64 * 1024);
    head.writeUInt32LE(body.length, 4);
    bufAry.push(head, body);
  }
  head = new Buffer('DONE____');
  head.writeUInt32LE(Date.now() / 1000, 4, /*noAssert:*/true);
  bufAry.push(head);
  return Buffer.concat(bufAry);
}

function htmlEncode(text) {
  return text.replace(/[^0-9a-zA-Z]/g, function (match) {
    return match === '&' ? '&amp;' : match === '<' ? '&lt;' : match === '>' ? '&gt;' : match === '"' ? '&quot;' : ('&#' + match.charCodeAt(0) + ';');
  });
}

function forEachValueIn(map, callback) {
  for (var k in map) //noinspection JSUnfilteredForInLoop
    callback(map[k]);
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

function dummyFunc() {
}

function passthrough() {
  for (var i = 0; i < arguments.length; i++) (typeof(arguments[i]) === 'function') && arguments[i]();
}
passthrough.once = passthrough.on = passthrough.listen = passthrough;

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

function isTcpConId(conId) {
  return /:\d+$/.test(conId);
}

function isDevConnectedReally(dev) {
  return dev.conStatus === 'device';
}

function createDev(conId/*sn or ip:port which maybe same on different host*/, adbHost/*optional*/) {
  var sn = isTcpConId(conId) ? '' : conId, devGrp = devGrpMap[sn] || (devGrpMap[sn] = []), dev = null;
  if (adbHost) {
    if (devGrp.some(function (_dev) {
        return _dev.adbHost === adbHost && _dev.conId === conId && (dev = _dev);
      })
      || devGrp.some(function (_dev) { //reuse fileOnly device (empty adbHost)
        return !_dev.adbHost && (dev = _dev) && setDevId();
      })) {
      return dev;
    }
  } else { //fileOnly device
    if ((dev = devGrp[0])) return dev;
  }
  dev = devAry[devAry.length] = devGrp[devGrp.length] = {
    i: devAry.length, status: '', touchStatus: '', touch: {}, info_htm: '', pref: {},
    adbConMap: {}, rdcWebSocketMap: {}, adbBridge: true,
    masterMode: false, accessKey: newAutoAccessKey().replace(/^.{10}/, '----------'), subOutputDir: ''
  };
  !adbHost && cfg.showDisconnectedDevices && scheduleUpdateWholeUI();
  return setDevId();

  function setDevId() {
    dev.id = conId + (!adbHost ? '' : '@' + adbHost);
    dev.conId = conId;
    dev.adbHost = adbHost;
    dev.sn = sn;
    dev.buf_switchTransport = adbHost_makeBuf(new Buffer('host:transport:' + conId));
    dev.idVar = dev.id.replace(/[^0-9a-zA-Z]/g, function (match) {
      return match === '@' ? '_at_' : match === ':' ? '_p_' : '_x' + match.charCodeAt(0).toString(16);
    });
    dev.idSort = (sn ? 'sn:' + sn : 'tcp:' + conId) + ' ' + 'host:' + (adbHost || '');
    dev.re_lastViewId_cookie = new RegExp('\\b' + cookie_id_head + 'viewId_' + dev.idVar + '=([^;]+)');
    return dev;
  }
}

function getDev(q /*{[IN]device, [IN]accessKey, [OUT]devHandle}*/, opt) {
  if (!chk('device', q.device)) {
    return null;
  }
  var conId = q.device.replace(/@[^:]+:\d+$/, ''), adbHostStr = q.device.slice(conId.length + 1),
    devGrp = devGrpMap[conId] || isTcpConId(conId) && adbHostStr && devGrpMap[''], dev = null;
  if (!devGrp) {
    return (chk.err = 'device not found') && null;
  }
  if (adbHostStr) {
    if (!devGrp.some(function (_dev) {
        return _dev.adbHost && _dev.adbHost.str === adbHostStr && _dev.conId === conId && (dev = _dev);
      })) {
      return (chk.err = 'device not found') && null;
    }
  } else {
    if (!devGrp.some(function (_dev) { //prefer connected device if adbHost is not specified
        return _dev.conStatus && (dev = _dev);
      }) && !(dev = devGrp[0])) {
      return (chk.err = 'device not found') && null;
    }
  }
  if (opt && opt.chkAccessKey && dev.accessKey && q.accessKey !== dev.accessKey.slice(11) && (chk.err = 'access denied')
    || opt && !chkDev(dev, opt)) {
    return null;
  }
  q._dev_i = dev.i;
  return dev;
}

function chkDev(dev, opt) {
  var failed = !dev && (chk.err = 'device not found')
      || opt.connected && !isDevConnectedReally(dev) && (chk.err = 'device not connected')
      || opt.capturing && !(dev.capture) && (chk.err = 'screen capture not started')
      || opt.image && !(dev.capture && dev.capture.image) && (chk.err = 'screen capture not started completely')
      || opt.adbBridge && !(dev.adbBridge && cfg['support_adbBridge']) && (chk.err = 'adbBridge disabled')
      || opt.capturable && !(dev.status === 'OK') && (chk.err = 'device not ready for capturing screen')
      || opt.touchable && !(dev.capture && dev.capture.touchSrv ) && (chk.err = 'device not ready for touch')
      || opt.touchable && dev.isPaused && (chk.err = 'device is paused')
      || opt.keybdable && !(dev.capture && dev.capture.keybdSrv ) && (chk.err = 'device not ready for keyboard')
      || opt.keybdable && !opt.powerButton && dev.isPaused && (chk.err = 'device is paused')
      || opt.orientable && !(dev.capture && dev.capture.screenController) && (chk.err = 'device not ready for changing orientation!')
      || opt.unlockable && !(dev.capture && dev.capture.screenController) && (chk.err = 'device not ready for turning on and unlocking screen')
      || opt.pausable && !(dev.capture && dev.capture.controller ) && (chk.err = 'device not ready for pause')
      || opt.pausable && !(!dev.isScreenOff) && (chk.err = 'screen not on')
      || opt.resumable && !(dev.capture && dev.capture.controller) && (chk.err = 'device not ready for resume')
      || opt.resumable && !(!dev.isScreenOff) && (chk.err = 'screen not on')
    ;
  return !failed;
}

function newAutoAccessKey() {
  return !cfg.adminKey ? '' : (getTimestamp().slice(4, 14) + '_' + crypto.createHash('md5').update(cfg.adminKey + Date.now() + Math.random()).digest('hex'));
}

function AdbHost(adbHostStr) {
  var host = adbHostStr.replace(/:\d+$/, ''), port = adbHostStr.slice(host.length + 1);
  this.host = host || 'localhost';
  this.port = port || 5037;
  this.str = this.host + ':' + this.port;
  (this.autoStartLocalAdbServer = !host) && !AdbHost.haveCheckedLocalAdb && (AdbHost.haveCheckedLocalAdb = true)
  && spawn('[CheckAdb]', cfg['adb'], ['version'], function/*on_close*/(err) {
    err && process.stderr.write('Warning: failed to check ADB(Android Debug Bridge) utility while you are configured to connect to some local port of ADB server.\nSo if ADB server is not started yet, this app can not start it and you need start it manually by command "adb start-server".\nYou\'d better install ADB and add path INSTALLED_DIR/platform-tools into PATH env var or set full path of adb to "adb" in config.json or your own config file.\n');
  }, {timeout: 30 * 1000});
}

AdbHost.prototype.toString = function () {
  return this.str;
};

function initDeviceTrackers() {
  cfg['adbHosts'].forEach(function (adbHostStr) {
    _initDeviceTracker(new AdbHost(adbHostStr));
  });

  setInterval(function () {
    devAry.forEach(function (dev) {
      dev.status === 'OK' && !Object.keys(dev.adbConMap).length && adbRun('[KeepAlive]', dev, 'a=', {timeout: 10 * 1000});
    });
  }, cfg['adbKeepDeviceAliveInterval'] * 1000);

  function _initDeviceTracker(adbHost) {
    var adbCon = adb('[TrackDevices]', adbHost, 'host:track-devices', function/*on_close*/() {
      adbCon.__on_adb_stream_data(EMPTY_BUF);
      setTimeout(function () {
        _initDeviceTracker(adbHost);
      }, cfg['adbRetryDeviceTrackerInterval'] * 1000);
    });
    adbCon.__on_adb_stream_data = function (buf) {
      var devList = [];
      buf.toString().split('\n').forEach(function (desc) { //noinspection JSValidateTypes
        var parts = desc.split('\t'), conId = parts[0], conStatus = parts[1], dev;
        if (!conId || !conStatus || conId === '????????????') return;
        if ((dev = devList[devList.length] = createDev(conId, adbHost)).conStatus !== conStatus) {
          (dev.conStatus = conStatus) && log('[TrackDevices] {' + dev.id + '}', isDevConnectedReally(dev) ? 'CONNECTED' : ('STATUS CHANGED: ' + conStatus));
          isDevConnectedReally(dev) ? prepareDevice(dev) : unprepareDevice(dev, conStatus, 'device unusable');
        }
      });
      devAry.forEach(function (dev) {
        if (dev.adbHost === adbHost && dev.conStatus && devList.indexOf(dev) < 0) {
          log('[TrackDevices] {' + dev.id + '}', 'DISCONNECTED');
          unprepareDevice(dev, '', 'device disconnected');
        }
      });
    }; //end of __on_adb_stream_data
  } //end of _trackDevices
} //end of trackDevices

function unprepareDevice(dev, conStatus, reason) {
  scheduleUpdateWholeUI();
  forEachValueIn(dev.adbConMap, function (adbCon) {
    adbCon.__cleanup(reason);
  });
  dev.capture && dev.capture.__cleanup(reason);
  dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.__cleanup(reason);
  dev.conStatus = conStatus;
  dev.status = dev.touchStatus = '';
  dev.isOsStartingUp = false;
  if (dev.conId !== dev.sn) { //for tcp device
    dev.sn && createDev(dev.sn); //create fileOnly entry for the disconnected tcp device
    dev.adbHost = dev.conId = ''; //make the device reusable and hidden
  }
}

var cmd_getBasicInfo = ' getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.product.cpu.abi; getprop ro.serialno; getprop ro.product.name; getprop ro.product.device; getprop net.hostname;'
  + ' echo ===; getevent -pS;'
  + ' echo ===;';
var cmd_getVer = ' cat ' + cfg.androidWorkDir + '/version';
var cmd_clearFiles = ' rm -r ' + cfg.androidWorkDir + ' 2>/dev/null; umask 007 && mkdir ' + cfg.androidWorkDir + ';';
var cmd_cdWorkDir = ' cd ' + cfg.androidWorkDir + ' || exit;';
var cmd_updateVerFile = ' chmod 770 * && echo $FILE_VER > version || exit;';
var cmd_getExtraInfo = ''
  + ' echo ===; dumpsys window policy | ./busybox grep -E \'mUnrestrictedScreen=|DisplayWidth=\';'
  + ' echo ===; ./busybox grep -Ec \'^processor\' /proc/cpuinfo;'
  + ' echo ===; ./busybox head -n 1 /proc/meminfo;'
  + ' echo ===; LD_LIBRARY_PATH=$LD_LIBRARY_PATH:. ./$DLOPEN ./sc-??? ./fsc-???;'
  + ' echo ===; ls -d /data/data/asc.tool.screencontroller 2>/dev/null;';
var cmd_uninstallScreenController = ' pm uninstall asc.tool.screencontroller >/dev/null 2>&1;';
var cmd_installScreenController = ' umask 003; cat ' + cfg.androidWorkDir + '/screencontroller.apk > ' + cfg.androidWorkDir + '-screencontroller.apk &&' +
  ' pm install ' + cfg.androidWorkDir + '-screencontroller.apk;';
var cmd_startScreenController = ' am startservice -n asc.tool.screencontroller/.ScreenControllerService $OPTION;';
var cmd_deleteScreenControllerApk = ' rm ' + cfg.androidWorkDir + '-screencontroller.apk >/dev/null 2>&1;';

function prepareDevice(dev, force/*optional*/) {
  if (dev.status === 'OK' && !force || dev.status === 'preparing') return;
  log('[PrepareDevice] {' + dev.id + '}', 'BEGIN');
  (dev.status = 'preparing') && scheduleUpdateWholeUI();
  force && forEachValueIn(dev.adbConMap, function (adbCon) {
    /InstallScreenController|StartScreenController|DeleteTempApk/.test(adbCon.__tag) && adbCon.__cleanup('restart preparing');
  });
  adbRun('[CheckBasicInfo]', dev, cmd_getBasicInfo + (force ? cmd_clearFiles : cmd_getVer), function/*on_close*/(err, stdout) {
    if (err) {
      return setStatus(err);
    }
    var parts = stdout.trim().split(/\s*===\s*/);
    if (parts.length !== 3) {
      return setStatus('failed to check basic info');
    }
    dev.info = parts[0].split(/\r*\n/);
    dev.sysVer = Number((dev.info[2] + '.0.0').split('.').slice(0, 3).join('.').replace(/\.([^.]+)$/, '$1')); //4.1.2 -> 4.12
    dev.armv = parseInt(dev.info[3].replace(/^armeabi-v|^arm64-v/, '')) >= 7 ? 7 : 5; //armeabi-v7a -> 7
    !dev.sn && (dev.sn = dev.info[4]/*sn*/) && scheduleUpdateWholeUI();

    getTouchDevInfo(parts[1]);

    if (parts[2] === fileVer) {
      return finishPrepare(/*fileChanged:*/false);
    }
    var adbCon = adb('[PushFile]', dev, 'sync:', function/*on_close*/(err, stdout) {
      if (err || (stdout = stdout.replace(/OKAY\0*/g, '').split(/FAIL..../)).length > 1) {
        return setStatus(err || ('failed to push file. reason: ' + (stdout[1] || 'unknown')));
      }
      return finishPrepare(/*fileChanged:*/true);
    }, {timeout: cfg['adbPushFileToDeviceTimeout'] * 1000, log: true}); //end of PushFileToDevice
    adbCon.once('__adb_stream_opened', function () {
      for (var _filename in pushContentMap) { //noinspection JSUnfilteredForInLoop
        var name = _filename, sysVer = parseInt(name.slice(name.replace(/-\d+$/, '').length + 1)) / 100, armv = parseInt(name.slice(name.replace(/\.armv\d+$/, '').length + 5));
        (!sysVer || sysVer <= dev.sysVer) && (!armv || dev.armv === armv)
        && (dev.sysVer < 5 ? !/\.pie$/.test(name) : !pushContentMap[name + '.pie']) //noinspection JSUnfilteredForInLoop
        && log(adbCon.__tag, 'push local file to ' + cfg.androidWorkDir + '/' + name)
        && adbCon.write(pushContentMap[name]);
      }
      adbCon.write(new Buffer('QUIT\0\0\0\0'));
    });
  }, {timeout: cfg['adbCheckBasicInfoTimeout'] * 1000, log: true}); //end of CheckBasicInfo

  function setStatus(status) {
    log('[PrepareDevice] {' + dev.id + '}', 'END: ' + status);
    dev.info && (dev.info_htm = htmlEncode(dev.info[0]/*manufacturer*/ + ' ' + dev.info[1]/*model*/ + ' ' + dev.info[2]/*release*/ + ' ' + ((dev.info[3] === 'armeabi-v7a' || dev.info[3] === 'arm64-v7a') ? '' : dev.info[3])
      + (dev.cpuCount === undefined ? '' : ' ' + dev.cpuCount + 'c') + (dev.memSize === undefined ? '' : ' ' + (dev.memSize / 1000).toFixed() + 'm') + (!dev.disp ? '' : ' ' + dev.disp.w + 'x' + dev.disp.h)));
    (dev.status = status) && scheduleUpdateWholeUI();
  }

  function finishPrepare(fileChanged) {
    adbRun('[FinishPrepare]', dev, cmd_cdWorkDir + (fileChanged ? cmd_uninstallScreenController + cmd_updateVerFile.replace(/\$FILE_VER/g, fileVer) : '') + cmd_getExtraInfo.replace(/\$DLOPEN/g, 'dlopen' + (dev.sysVer >= 5 ? '.pie' : '')), function/*on_close*/(err, stdout) {
      if (err) {
        return setStatus(err);
      }
      var parts = stdout.trim().split(/\s*===\s*/);
      if (parts.length !== 6) {
        return setStatus('failed to prepare: unexpected result format');
      } else if (parts[0]) {
        return setStatus('failed to prepare: unexpected result: ' + parts[0].replace(/\s/g, ' ').trim());
      } else if (!getMoreInfo(parts)) {
        return setStatus(dev.isOsStartingUp ? 'starting up' : ('failed to ' + (!dev.libPath ? 'check internal lib' : !dev.disp ? 'check display size' : '?')));
      }
      parts[5] === '/data/data/asc.tool.screencontroller' ? startScreenController(dev) : installScreenController(dev);
      return setStatus('OK');
    }, {timeout: cfg['adbFinishPrepareFileTimeout'] * 1000, log: true});
  } //end of finishPrepare

  function getMoreInfo(parts/*result of cmd_getExtraInfo*/) {
    if ((dev.isOsStartingUp = (parts[1] === "Can't find service: window"))) {
      setTimeout(function () {
        prepareDevice(dev);
      }, 1000)
    } else {
      (parts[1] = parts[1].match(/([1-9]\d\d+)\D+([1-9]\d\d+)/)) && (dev.disp = {
        w: Math.min(parts[1][1], parts[1][2]),
        h: Math.max(parts[1][1], parts[1][2])
      }) && [1, 2, 4, 5, 6, 7].forEach(function (i) {
        dev.disp[i] = {w: Math.ceil(dev.disp.w * i / 8 / 2) * 2, h: Math.ceil(dev.disp.h * i / 8 / 2) * 2};
      });
    }
    dev.cpuCount = Number(parts[2]) || 1;
    (parts[3] = parts[3].match(/\d+/)) && (dev.memSize = Number(parts[3][0]));
    var libs = parts[4].split(/\r*\n/).sort();
    dev.libPath = (libs.filter(function (lib) {
      return /^\.\/sc.*: OK$/.test(lib);
    }).pop() || '').replace(': OK', '');
    dev.fastLibPath = (libs.filter(function (lib) {
      return /^\.\/fsc.*: OK$/.test(lib);
    }).pop() || '').replace(': OK', '');
    return !dev.isOsStartingUp && dev.libPath && dev.disp;
  }

  function getTouchDevInfo(stdout) {
    dev.touch.modernStyle = stdout.indexOf('INPUT_PROP_DIRECT') >= 0;
    dev.touchStatus = stdout.split(/add device \d+: /).some(function (devInfo) {
      var match = {};
      if ((match['0035'] = devInfo.match(/\D*0035.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_X*/ && (match['0036'] = devInfo.match(/\D*0036.*value.*min.*max\D*(\d+)/)) /*ABS_MT_POSITION_Y*/) {
        if ((dev.touch.modernStyle && devInfo.indexOf('INPUT_PROP_DIRECT') >= 0) || (!dev.touch.modernStyle && !devInfo.match(/\n +name: +.*pen/))) {
          dev.touch.w = Math.floor((Number(match['0035'][1]) + 1) / 2) * 2;
          dev.touch.h = Math.floor((Number(match['0036'][1]) + 1) / 2) * 2;
          if (!dev.touch.w || !dev.touch.h) {
            log('[CheckTouchDev] {' + dev.id + '}', 'strange: max_x=' + match['0035'][1] + ' max_y=' + match['0036'][1]);
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
    log('[CheckTouchDev] {' + dev.id + '}', dev.touchStatus + ' ' + (dev.touchStatus === 'OK' ? JSON.stringify(dev.touch) : ''));
  } //end of chkTouchDev
} //end of prepareDevice

function installScreenController(dev) {
  adbRun('[InstallScreenController]', dev, cmd_installScreenController, function/*on_close*/(err, stdout) {
    if (err || !/\n(Success|INSTALL_FAILED_ALREADY_EXISTS)/.test(stdout)) return;
    startScreenController(dev);
    adbRun('[DeleteTempApk]', dev, cmd_deleteScreenControllerApk, {timeout: 2 * 1000, log: true});
  }, {timeout: cfg['adbInstallScreenControllerTimeout'] * 1000, log: true});
}

function startScreenController(dev) {
  !dev.am_startservice_option && (dev.am_startservice_option = (dev.sysVer >= 4.22 ? '--user 0' : ''));
  adbRun('[StartScreenController]', dev, cmd_startScreenController.replace(/\$OPTION/, dev.am_startservice_option), function /*on_close*/(err, stdout) {
    if (err) return;
    if (/^Starting service:/.test(stdout) && !/Error|Exception:/.test(stdout)) {
      dev.capture && connectScreenController(dev);
    } else if (/^Error: Unknown option: --user:/.test(stdout)) {
      dev.am_startservice_option = '';
      startScreenController(dev);
    } else if (/\nSecurityException:.*not privileged to communicate with user/.test(stdout)) {
      dev.am_startservice_option = '--user 0';
      startScreenController(dev);
    } else if (/\nError: Not found; no service started/.test(stdout)) {
      installScreenController(dev);
    }
  }, {timeout: cfg['adbStartScreenControllerTimeout'] * 1000, log: true});
}

function connectScreenController(dev) {
  var capture = dev.capture, q = capture.q, acc_str = '';
  var adbCon = capture.screenController = adb('[ScreenController]', dev, 'localabstract:asc.tool.screencontroller', function/*on_close*/(err) {
    capture.screenController = null;
    err !== 'capture closed' && startScreenController(dev);
  }, {log: true});
  adbCon.on('__adb_stream_opened', function () {
    turnOnScreen(dev, /*unlock:*/true);
    if (dev.explicit_devOrient) {
      setDeviceOrientation(dev, dev.explicit_devOrient);
    } else if (q.orientation) {
      setDeviceOrientation(dev, q.orientation);
    } else {
      setDeviceOrientation(dev, q.orient, /*doNotRemember:*/true);
      capture.timer_free_devOrient = setTimeout(function () {
        setDeviceOrientation(dev, 'free', /*doNotRemember:*/true);
      }, 5 * 1000);
    }
  });
  adbCon.__on_adb_stream_data = function (buf) {
    log(adbCon.__tag + '>', buf.toString());
    acc_str += buf.toString();
    acc_str.split(/\n/).forEach(function (ls, i, ary) {
      if (i === ary.length - 1) {
        acc_str = ls;
      } else if (ls === 'screen:on') {
        dev.isScreenOff = dev.isPaused = false;
        capture.controller && capture.controller.__sendCmd('1');
      } else if (ls === 'screen:off') {
        dev.isScreenOff = dev.isPaused = true;
        capture.controller && capture.controller.__sendCmd('0');
      }
    });
  };
}

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
  if (!chkDev(dev, {
      connected: true,
      capturing: true,
      keybdable: true,
      powerButton: isKeyCode && keyCodeOrText === 'POWER' || keyNameMapOfCode[keyCodeOrText] === 'POWER'
    })
    || isKeyCode && !keyNameMapOfCode[keyCodeOrText] && !(keyCodeOrText = keyCodeMapOfName[keyCodeOrText]) && (chk.err = '`keyCode`: must be in ' + JSON.stringify(Object.keys(keyNameMapOfCode).concat(Object.keys(keyCodeMapOfName))) )
    || !isKeyCode && !chk('text', keyCodeOrText)) {
    return false;
  }
  if (isKeyCode) {
    if (dev.isScreenOff && dev.sysVer < 4.2 && keyNameMapOfCode[keyCodeOrText] === 'POWER') {
      turnOnScreen(dev, /*unlock:*/true);
    } else {
      dev.capture.keybdSrv.__runCmd('k ' + keyCodeOrText);
    }
  } else {
    keyCodeOrText.slice(0, cfg['maxTextInputLength']).split(/\r*\n/).forEach(function (ls, n) {
      n && dev.capture.keybdSrv.__runCmd('k ' + keyCodeMapOfName['ENTER']);
      dev.capture.keybdSrv.__runCmd('K ' + ls.replace(/\t/g, '    '));
    });
  }
  return true;
}

function setDeviceOrientation(dev, orient, doNotRemember) {
  if (!chkDev(dev, {connected: true, capturing: true, orientable: true})
    || !chk('orientation', orient, ['landscape', 'portrait', 'free'])) {
    return false;
  }
  clearTimeout(dev.capture.timer_free_devOrient);
  (dev.capture.screenController.__adb_stream_opened ? passthrough : dev.capture.screenController).once('__adb_stream_opened', function () {
    cfg.logAllProcCmd && log(dev.capture.screenController.__tag + '<', orient);
    dev.capture.screenController.write('orient:' + orient + '\n');
  });
  !doNotRemember && (dev.explicit_devOrient = orient);
  return true;
}

function turnOnScreen(dev, unlock) {
  if (!chkDev(dev, {connected: true, capturing: true})) {
    return false;
  }
  if (chkDev(dev, {unlockable: true})) {
    (dev.capture.screenController.__adb_stream_opened ? passthrough : dev.capture.screenController).once('__adb_stream_opened', function () {
      cfg.logAllProcCmd && log(dev.capture.screenController.__tag + '<', 'screen:on' + (unlock ? '+unlock' : ''));
      dev.capture.screenController.write('screen:on' + (unlock ? '+unlock' : '') + '\n');
    });
  } else {
    dev.adbCon_turnOnScreen && dev.adbCon_turnOnScreen.__cleanup('new request comes');
    (dev.adbCon_turnOnScreen = adbRun('[TurnScreenOn]', dev, 'dumpsys power | ' + (dev.sysVer >= 4.22 ? 'grep' : cfg.androidWorkDir + ' /busybox grep') + ' -q ' + (dev.sysVer >= 4.22 ? 'mScreenOn=false' : 'mPowerState=0') + ' && input keyevent 26 && input keyevent 82', function/*on_close*/() {
      dev.adbCon_turnOnScreen = null;
    }, {timeout: 10 * 1000}));
  }
  return true;
}

function encryptSn(sn) {
  sn = sn || ' ';
  var d, i;
  if (cfg['should_callAscLibSecurely']) {
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
  q._priority = (q.size || q.orient || q.fastCapture || q.fastResize) ? 1 : 0;
  if (dev && !chkDev(dev, {connected: true, capturable: true})
    || dev && !chk('type', q.type = force_ajpg ? 'ajpg' : q.type || 'ajpg', ['ajpg', 'jpg'])
    || ( !(q._psz = (q.size = q.size || (dev && dev.pref.viewSize) || cfg.viewSize).match(re_size)) && !((q._scaleFactor = Number(q.size)) >= 0.1 && q._scaleFactor <= 1) && (chk.err = '`size`: must be resize factor (>=0.1 <=1) or size patterns: Example: 400x600, 400x, x600 (600x400 means landscape)') )
    || !chk('orient', (q.orient = q.orient || (dev && dev.pref.viewOrient) || cfg.viewOrient), ['portrait', 'landscape'])
    || !chk('fastResize', (q.fastResize = q.fastResize || (dev && dev.pref.fastResize) || String(cfg.fastResize)), ['true', 'false'])
    || !chk('fastCapture', (q.fastCapture = q.fastCapture || (dev && dev.pref.fastCapture) || String(cfg.fastCapture)), ['true', 'false'])) {
    return false;
  }
  var w = q._psz ? Number(q._psz[1] || q._psz[3]) : 0, h = q._psz ? Number(q._psz[2] || q._psz[4]) : 0;
  (w && h) && (q.orient = (w > h) ? 'landscape' : 'portrait'); //adjust orientation if w > h

  if (dev) {
    dev.pref.viewSize = q.size;
    dev.pref.viewOrient = q.orient;
    dev.pref.fastResize = q.fastResize;
    dev.pref.fastCapture = q.fastCapture;
    var landscape = (q.orient === 'landscape');

    //set q._psz = normalized portrait size. (keep q._psz.w < q._psz.h)  Note: dev.disp.w always < dev.disp.h
    if (w && h) {
      q._psz = {w: Math.min(w, h), h: Math.max(w, h)};
    } else if (w || h) {
      if (landscape) {
        q._psz = {w: h, h: w};
      } else {
        q._psz = {w: w, h: h};
      }
    } else {
      q._psz = {w: dev.disp.w * q._scaleFactor, h: dev.disp.h * q._scaleFactor};
    }
    q._psz = {
      w: Math.min(dev.disp.w, Math.ceil((q._psz.w || q._psz.h * dev.disp.w / dev.disp.h) / 2) * 2),
      h: Math.min(dev.disp.h, Math.ceil((q._psz.h || q._psz.w * dev.disp.h / dev.disp.w) / 2) * 2)
    };

    q.fastResize = q.fastResize === 'true' && (!!dev.fastLibPath || dev.libPath >= './sc-400');
    q.fastCapture = q.fastCapture === 'true' && !!dev.fastLibPath;
    if (q.fastResize) { //resize image by hardware. Adjust q._psz to be n/8
      var r = Math.max(q._psz.w * 8 / dev.disp.w, q._psz.h * 8 / dev.disp.h);
      q._psz = r <= 1 ? dev.disp[1] : r <= 2 ? dev.disp[2] : r <= 4 ? dev.disp[4] : r <= 5 ? dev.disp[5] : r <= 6 ? dev.disp[6] : r <= 7 ? dev.disp[7] : dev.disp;
      q.fastResize = q._psz.w !== dev.disp.w || q._psz.h !== dev.disp.h;
    } else {
      var rr = Math.max(q._psz.w / dev.disp.w, q._psz.h / dev.disp.h);
      q._psz = {
        w: Math.min(dev.disp.w, Math.ceil((rr * dev.disp.w) / 2) * 2),
        h: Math.min(dev.disp.h, Math.ceil((rr * dev.disp.h) / 2) * 2)
      };
    }
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

    if (dev.capture && !forRecording && req.headers.cookie && (q._lastViewId = req.headers.cookie.match(dev.re_lastViewId_cookie)) && (q._lastViewId = q._lastViewId[1]))
      forEachValueIn(dev.capture.consumerMap, function (res) {
        (res.q.timestamp === q._lastViewId) && endCaptureConsumer(res);
      });

    q._promise_q = dev.capture ? dev.capture.q : q;
  }
  return true;
}

function _startRemoteDesktopServer(dev, q) {
  var capture = dev.capture = {q: q, consumerMap: {}, __cleanup: cleanup}, bufAry = [], foundMark = false;
  connectScreenController(dev);
  var adbCon = capture.adbCon = adbRun('[ScreenCapture]', dev, '{ date >&2 && cd ' + cfg.androidWorkDir
    + ' && export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:.' + (cfg.logFfmpegDebugInfo ? ' && export ASC_LOG_ALL=1' : '')
    + ' && export ASC_=' + encryptSn(dev.info[7]/*android-id*/.slice(8/*skip 'android-'*/) || dev.info[4]/*internalSN*/)
    + ' && export ASC_CMD_SOCKET=' + cfg.androidWorkDir + ' && export ASC_TOUCH_SOCKET=' + dev.touch.devPath
    + ' && exec ./ffmpeg.armv' + dev.armv + (dev.sysVer >= 5 ? '.pie' : '')
    + ' -loglevel ' + (cfg.logFfmpegDebugInfo ? 'debug' : 'error -nostats')
    + ' -vsync drop -nostdin'
    + ' -f androidgrab' + (q._reqSz ? (' -width ' + q._reqSz.w + ' -height ' + q._reqSz.h) : '')
    + ' -i ' + (q.fastCapture ? dev.fastLibPath : dev.libPath)
    + (q._filter ? (' -vf \'' + q._filter + '\'') : '')
    + ' -f mjpeg -q:v 1 -'
    + ' ; } 2>' + cfg.androidLogPath // "-" means stdout
    , function/*on_close*/(err) {
      cleanup(err || 'CLOSED');
    }, {log: true});
  adbCon.__on_adb_stream_data = function (buf) {
    var pos = 0, unsavedStart = 0, endPos = buf.length;
    for (; pos < endPos; pos++) {
      if (foundMark && buf[pos] === 0xD9) {
        capture.image = {
          buf: Buffer.concat(bufAry.push(buf.slice(unsavedStart, pos + 1)) && bufAry),
          i: capture.image ? capture.image.i + 1 : 1
        };
        bufAry.length = 0;
        unsavedStart = pos + 1;
        forEachValueIn(capture.consumerMap, function (res) {
          res.setHeader/*isHttp*/ && (res.q.type === 'ajpg' ? writeMultipartImage : endCaptureConsumer)(res, capture.image.buf);
        });//end of consumer enum
      }
      foundMark = (buf[pos] === 0xff);
    } //end of for loop in buffer
    unsavedStart < endPos && bufAry.push(buf.slice(unsavedStart, endPos));

    if (capture.controller === undefined) {
      capture.controller = adb('[ScreenCaptureController]', dev, 'localabstract:' + cfg.androidWorkDir, function/*on_close*/() {
        capture.controller = null;
      });
      capture.controller.__sendCmd = function (cmd) {
        (capture.controller.__adb_stream_opened ? passthrough : capture.controller).once('__adb_stream_opened', function () {
          cfg.logAllProcCmd && log(capture.controller.__tag + '<', cmd);
          capture.controller.write(cmd);
        });
      };
    }

    if (capture.touchSrv === undefined) {
      capture.touchSrv = adb('[TouchSrv]', dev, 'localabstract:' + dev.touch.devPath, function/*on_close*/() {
        capture.touchSrv = null;
      });
      capture.touchSrv.__sendEvent = function (type, code, value) {
        touchEventBuf.writeUInt16LE(type, 0, /*noAssert:*/true);
        touchEventBuf.writeUInt16LE(code, 2, /*noAssert:*/true);
        touchEventBuf.writeInt32LE(value, 4, /*noAssert:*/true);
        (capture.touchSrv.__adb_stream_opened ? passthrough : capture.touchSrv).once('__adb_stream_opened', function () {
          cfg.logAllProcCmd && log(capture.touchSrv.__tag + '<', 'T ' + type + ' ' + code + ' ' + value);
          capture.touchSrv.write(touchEventBuf);
        });
      };
    }
  };

  q.fastCapture && (capture.timer_resentImageForSafari = setInterval(function () { //resend image once for safari to force display
    capture.image && (capture.image.i === capture.oldImageIndex ? forEachValueIn(capture.consumerMap, function (res) {
      res.q._isSafari && !res.__didResend && (res.__didResend = true) && writeMultipartImage(res, capture.image.buf, /*doNotCount:*/true);
    }) : ((capture.oldImageIndex = capture.image.i) && forEachValueIn(capture.consumerMap, function (res) {
      res.__didResend = false;
    })));
  }, cfg['resentImageForSafariAfter'] * 1000));
  capture.timer_resentUnchangedImage = setInterval(function () { //resend image to keep image tag alive
    capture.image && (capture.image.i === capture.veryOldImageIndex ? forEachValueIn(capture.consumerMap, function (res) {
      writeMultipartImage(res, capture.image.buf, /*doNotCount:*/true);
    }) : (capture.veryOldImageIndex = capture.image.i));
  }, cfg['resentUnchangedImageInterval'] * 1000);

  capture.keybdSrv = adb('[KeybdSrv]', dev, 'shell:', function/*on_close*/() {
    capture.keybdSrv = null;
  });
  capture.keybdSrv.once('__adb_stream_opened', function () {
    capture.keybdSrv.__runCmd('exec >/dev/null 2>&1');
    capture.keybdSrv.__runCmd('cd ' + cfg.androidWorkDir);
    capture.keybdSrv.__runCmd('./busybox stty -echo -onlcr; PS1=');
    capture.keybdSrv.__runCmd('mkdir ./dalvik-cache; export ANDROID_DATA=.; export CLASSPATH=./keybdserver.jar:/system/framework/input.jar; exec /system/bin/app_process /system/bin keybdserver.KeybdServer');
  });
  capture.keybdSrv.__runCmd = function (cmd) {
    (capture.keybdSrv.__adb_stream_opened ? passthrough : capture.keybdSrv).once('__adb_stream_opened', function () {
      cfg.logAllProcCmd && log(capture.keybdSrv.__tag + '<', cmd);
      capture.keybdSrv.write(cmd + '\n');
    });
  };
  capture.keybdSrv.__on_adb_stream_data = function (buf) {
    cfg.logAllProcCmd && log(capture.keybdSrv.__tag + '>', buf, /*autoNewLine:*/false);
  };

  return capture;

  function cleanup(reason) {
    if (cleanup.called) return;
    cleanup.called = true;
    forEachValueIn(capture.consumerMap, endCaptureConsumer);
    clearTimeout(capture.delayKillTimer);
    clearTimeout(capture.timer_free_devOrient);
    clearInterval(capture.timer_resentImageForSafari);
    clearInterval(capture.timer_resentUnchangedImage);
    capture.adbCon && capture.adbCon.__cleanup(reason);
    capture.controller && capture.controller.__cleanup('capture closed');
    capture.touchSrv && capture.touchSrv.__cleanup('capture closed');
    capture.keybdSrv && capture.keybdSrv.__cleanup('capture closed');
    capture.screenController && capture.screenController.__cleanup('capture closed');
    dev.capture = null;
    forEachValueIn(dev.rdcWebSocketMap, function (rdcWebSocket) {
      delete rdcWebSocket.devMapOfHandle[dev.i];
      !Object.keys(rdcWebSocket.devMapOfHandle).length && rdcWebSocket.__cleanup('capture closed');
    });
    dev.rdcWebSocketMap = {};
    dev.isScreenOff = dev.isPaused = dev.explicit_devOrient = null;
    scheduleUpdateLiveUI();
  }
}

function doCapture(dev, res/*Any Type Output Stream*/, q) {
  scheduleUpdateLiveUI();
  var useExisting = !!dev.capture, capture = dev.capture || _startRemoteDesktopServer(dev, q);
  capture.consumerMap[res.__tag] = res;
  clearTimeout(capture.delayKillTimer);
  res.q = q;
  res.once('close', function () {
    endCaptureConsumer(res);
  });
  res.setHeader && res.setHeader('Content-Type', q.type === 'ajpg' ? 'multipart/x-mixed-replace;boundary=MULTIPART_BOUNDARY' : 'image/jpeg');
  res.setHeader && q.type === 'ajpg' && res.setHeader('Set-Cookie', cookie_id_head + 'viewId_' + dev.idVar + '=' + q.timestamp + '; HttpOnly');
  res.setHeader/*http*/ && q.type === 'ajpg' && (res.__statTimer = setInterval(function () {
    res.output.length >= 30 && !res.__didResend && (res.__framesDropped = 28) && (res.output.length = res.outputEncodings.length = res.output.length - res.__framesDropped);
    (cfg.logFpsStatistic || res.__framesDropped) && log(res.__tag + ' ' + capture.adbCon.__tag, 'statistics: Fps=' + ((res.__framesWritten || 0) / cfg.fpsStatisticInterval).toPrecision(3) + (res.__framesDropped ? ' dropped frames: ' + res.__framesDropped : ''));
    res.__framesWritten = res.__framesDropped = 0;
  }, cfg.fpsStatisticInterval * 1000));
  (capture.q.fastCapture || dev.isPaused) && capture.image && (res.setHeader && q.type === 'ajpg') && writeMultipartImage(res, capture.image.buf);
  q.type === 'jpg' && capture.image && endCaptureConsumer(res, capture.image.buf);
  q.type === 'jpg' && capture.image && useExisting && clearTimeout(status.updateLiveUITimer); //remove unnecessary update if not new capture process
}

function doRecord(dev, q/*same as capture*/) {
  var filename = querystring.escape(dev.sn) + '~rec_' + q._promise_q._hash + '_' + q.timestamp + '.mp4', outPath = cfg.outputDir + '/' + filename;
  var childProc = spawn('[Record] {' + dev.id + '}', cfg['ffmpeg'], [
    '-y' /*overwrite output*/, '-nostdin', '-nostats', '-loglevel', cfg.logFfmpegDebugInfo ? 'debug' : 'error',
    '-f', 'mjpeg', '-r', cfg.videoFileFrameRate, '-i', '-'/*stdin*/, '-pix_fmt', 'yuv420p'/*for safari mp4*/, outPath
  ], function/*on_close*/() {
    dev.subOutputDir && fs.link(outPath, cfg.outputDir + '/' + dev.subOutputDir + '/' + filename, function (e) {
      e && log(childProc.__tag, 'failed to create dir link. ' + e);
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
  var capture = devAry[res.q._dev_i].capture;
  if (!capture || capture.consumerMap[res.__tag] !== res) return;
  delete capture.consumerMap[res.__tag];
  scheduleUpdateLiveUI();
  end(res, imageBuf);
  clearTimeout(res.__recordTimer);
  clearInterval(res.__statTimer);
  clearInterval(res.__feedConvertTimer);
  !Object.keys(capture.consumerMap).length && (capture.delayKillTimer = setTimeout(function () {
    capture.__cleanup('no more consumer');
  }, cfg['adbCaptureExitDelayTime'] * 1000));
}

function scheduleUpdateLiveUI() {
  if (!Object.keys(status.consumerMap).length) return;
  clearTimeout(status.updateLiveUITimer);
  status.updateLiveUITimer = setTimeout(function () {
    var sd = {}, json;
    devAry.forEach(function (dev) {
      if (dev.conStatus || cfg.showDisconnectedDevices) {
        var liveViewCount = !dev.capture ? 0 : Object.keys(dev.capture.consumerMap).length - (dev.capture.consumerMap[REC_TAG] ? 1 : 0);
        sd['liveViewCount_' + dev.idVar] = liveViewCount ? '(' + liveViewCount + ')' : '';
        sd['recordingCount_' + dev.idVar] = dev.capture && dev.capture.consumerMap[REC_TAG] ? '(1)' : '';
        sd['captureParameter_' + dev.idVar] = dev.capture ? dev.capture.q._disp : '';
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
  return html.replace(/@device\b/g, querystring.escape(dev.id)).replace(/#device\b/g, htmlEncode(dev.id)).replace(/\$device\b/g, dev.idVar).replace(/#devIdDisp\b/g, htmlEncode((dev.sn === dev.conId ? ' ' : '(' + dev.sn + ')') + dev.id))
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
  res.__log && (res.__tag = '[HTTP_' + (++httpSeq) + ']' + (q.device ? (' {' + q.device + '}') : ''));
  res.__log && log(res.__tag, 'REQ: ' + req.url + (req.headers.range ? ' range:' + req.headers.range : '') + (' [from ' + getHttpSourceAddresses(req) + ']').replace(' [from localhost]', '') + (cfg.logHttpReqDetail ? ' [' + req.headers['user-agent'] + ']' : ''));
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
    return q.type === 'ajpg' || (q._isFirstSingleJpgReq = !q.timestamp);
  }
};
(streamWeb_handlerMap['/saveImage'] = function (req, res, q, urlPath, dev) {
  if (!cfg['enable_getFileFromStreamWeb'] && cfg.adminKey && q.adminKey !== cfg.adminKey && dev.re_lastViewId_cookie.test(req.headers.cookie) && (chk.err = 'access denied')
    || !chkDev(dev, {connected: true, capturing: true, image: true})) {
    return end(res, chk.err);
  }
  q.filename = querystring.escape(dev.sn) + '~live_' + dev.capture.q._hash + '_' + dev.capture.q.timestamp + '~frame' + String.fromCharCode(65 + String(dev.capture.image.i).length - 1) + dev.capture.image.i + '.jpg';
  fs.writeFile(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, dev.capture.image.buf, function (e) {
    e ? log('[SaveImage] {' + dev.id + '}', e) : (dev.subOutputDir && fs.link(cfg.outputDir + '/' + dev.subOutputDir + '/' + q.filename, cfg.outputDir + '/' + q.filename, function (e) {
      e && log('[SaveImage] {' + dev.id + '}', 'failed to create file link. ' + e);
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
  end(res, turnOnScreen(dev, q['unlock'] === 'true') ? 'OK' : chk.err);
}).option = {log: true};
(streamWeb_handlerMap['/setOrientation'] = function (req, res, q, urlPath, dev) {
  end(res, setDeviceOrientation(dev, q.orientation) ? 'OK' : chk.err);
}).option = {log: true};
(streamWeb_handlerMap['/showHome'] = function (req, res, q, urlPath, dev) {
  if (!chkDev(dev, {connected: true, capturing: true})) {
    return end(res, chk.err);
  }
  adbRun('[ShowHome]', dev, 'am start -c android.intent.category.HOME -a android.intent.action.MAIN', {timeout: 5 * 1000});
  return end(res, 'OK');
}).option = {log: true};
(streamWeb_handlerMap['/pause'] = streamWeb_handlerMap['/resume'] = function (req, res, q, urlPath, dev) {
  if (!chkDev(dev, {
      connected: true,
      capturing: true,
      pausable: urlPath === '/pause',
      resumable: urlPath === '/resume'
    })) {
    return end(res, chk.err);
  }
  dev.isPaused = (urlPath === '/pause');
  dev.capture.controller.__sendCmd(dev.isPaused ? '-' : '+');
  return end(res, 'OK');
}).option = {log: true};
streamWeb_handlerMap['/liveViewer.html'] = function (req, res, q, urlPath, dev) {
  if (!chkCaptureParameter(dev, req, q, /*force_ajpg:*/true)) {
    return end(res, chk.err);
  }
  return end(res, replaceComVar(htmlCache[urlPath], dev).replaceShowIf('masterMode', dev.masterMode)
      .replace(/@size\b/g, q._promise_q.size).replace(/@orient\b/g, q._promise_q.orient).replace(/@fastCapture\b/g, q._promise_q.fastCapture).replace(/@fastResize\b/g, q._promise_q.fastResize).replace(/@orientation\b/g, q.orientation || '')
      .replace(/checkedIf_fastCapture\b/g, q._promise_q.fastCapture ? 'checked' : '').replace(/checkedIf_fastResize\b/g, q._promise_q.fastResize ? 'checked' : '')
      .replace(/enabledIf_can_fastCapture\b/g, dev.fastLibPath ? '' : 'disabled').replace(/enabledIf_can_fastResize\b/g, !!dev.fastLibPath || dev.libPath >= './sc-400' ? '' : 'disabled')
      .replace(/__server_using_websocket\b/g, websocket ? 'true' : 'false')
    , 'text/html');
};
streamWeb_handlerMap['/videoViewer.html'] = streamWeb_handlerMap['/imageViewer.html'] = function (req, res, q, urlPath, dev) {
  if (!cfg['enable_getFileFromStreamWeb'] && cfg.adminKey && q.adminKey !== cfg.adminKey && (chk.err = 'access denied')) {
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
          return sortedKeys.slice(0, Number(q.count) || cfg['maxImagesInImageViewer']).reduce(function (joinedStr, key) {
            return joinedStr + htmlBlock.replace(/@filename\b/g, querystring.escape(filenameMap[key]));
          }, ''/*initial joinedStr*/);
        }), 'text/html');
    }
  });
};
streamWeb_handlerMap['/getFile'] = function (req, res, q, urlPath, dev) {
  if (!cfg['enable_getFileFromStreamWeb'] && cfg.adminKey && q.adminKey !== cfg.adminKey && (chk.err = 'access denied')
    || !(q.filename = new FilenameInfo(q.filename, dev.sn)).isValid && (chk.err = '`filename`: invalid name')) {
    return end(res, chk.err);
  }
  if ((q._range = (req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/i))) {
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
  else if (q.action && dev.capture) {
    forEachValueIn(dev.capture.consumerMap, function (res) {
      if (q.action === 'stopLiveView' ? res.__tag !== REC_TAG : res.__tag === REC_TAG) endCaptureConsumer(res);
    });
    !Object.keys(dev.capture.consumerMap).length && dev.capture.__cleanup('on demand'); //end capture process immediately if no any consumer exists
  }
  q.adbBridge && !(dev.adbBridge = (q.adbBridge === 'true')) && dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.__cleanup('disabled');
  return q.action === 'startRecording' ? end(res, doRecord(dev, q)) : end(res, 'OK');
}).option = {log: true};
(adminWeb_handlerMap['/prepareAllDevices' + cfg.adminUrlSuffix] = function (req, res, q) {
  q.mode === 'forcePrepare' && reloadPushFiles();
  devAry.forEach(function (dev) {
    isDevConnectedReally(dev) && prepareDevice(dev, q.mode === 'forcePrepare');
  });
  end(res, 'OK');
}).option = {log: true};
(adminWeb_handlerMap['/prepareDeviceForcibly' + cfg.adminUrlSuffix] = function (req, res, q, urlPath, dev) {
  if (!chkDev(dev, {connected: true})) {
    return end(res, chk.err);
  }
  reloadPushFiles();
  prepareDevice(dev, /*force:*/true);
  end(res, 'OK');
}).option = {log: true};
adminWeb_handlerMap['/getWebHost'] = function (req, res) {
  end(res, JSON.stringify({
    adminHost: req.connection.address().address + ':' + cfg.adminWeb_port,
    streamHost: req.connection.address().address + ':' + cfg.streamWeb_port
  }), 'text/json');
};
adminWeb_handlerMap['/getAdbHost'] = function (req, res, q, urlPath, dev) {
  end(res, JSON.stringify(chkDev(dev, {connected: true}) ? {
    host: dev.adbHost.host,
    port: dev.adbHost.port,
    conId: dev.conId
  } : chk.err), 'text/json');
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
    return devAry.filter(function (dev) {
      return dev.conStatus || (cfg.showDisconnectedDevices && dev.conId);
    }).sort(function (dev1, dev2) {
      return dev1.info_htm.localeCompare(dev2.info_htm) || dev1.idSort.localeCompare(dev2.idSort);
    }).reduce(function (joinedStr, dev, i) {
      return joinedStr + replaceComVar(htmlBlock, dev)
          .replace(/#devErr\b/g, htmlEncode(!dev.conStatus ? 'no device' : dev.status === 'preparing' ? 'preparing' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? '' : dev.touchStatus) : dev.status))
          .replace(/@devStatusClass\b/g, !dev.conStatus ? 'devFileOnly' : dev.status === 'preparing' ? 'devPrep' : dev.status === 'OK' ? (dev.touchStatus === 'OK' ? 'devOK' : 'devErr') : 'devErr')
          .replace(/#accessKey_disp\b/g, htmlEncode(dev.accessKey)).replace(/@masterMode\b/g, dev.masterMode).replace(/@rowNum\b/g, String(i + 1))
    }, ''/*initial joinedStr*/);
  }), 'text/html');
};
adminWeb_handlerMap['/getServerLog' + cfg.adminUrlSuffix] = function (req, res, q) {
  q._logFilePath = log.getLogFilePath(q['logHowManyDaysAgo']);
  if (!(q._fileSize = getFileSizeSync(q._logFilePath) || (q.mode && !chk('size', q.size = Number(q.size), 1, Number.MAX_VALUE)))) {
    return end(res, chk.err);
  }
  q.download === 'true' && res.setHeader('Content-Disposition', 'attachment;filename=' + Path.basename(q._logFilePath)); //remove dir part
  q.device && (res.__oldWrite = res.write) && (res.write = function (buf) {
    Buffer.concat([res.__orphanBuf, buf]).toString('binary').split(/\n/).forEach(function (s, i, lineAry) {
      (q._pos = s.indexOf(q.device)) >= 0 && res.__oldWrite(s.slice(0, q._pos) + s.slice(q._pos + q.device.length) + '\n', 'binary');
      i === lineAry.length - 1 && q._pos < 0 && (res.__orphanBuf = new Buffer(s, 'binary'));
    });
  }) && (res.__orphanBuf = EMPTY_BUF) && (q.device = '{' + q.device + '}');
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
  var dev = getDev(q, {connected: true}), restLen = (q.size = Number(q.size)) > 0 ? q.size : cfg['adbAdmCmdMaxOutputLength'];
  if (!dev) {
    end(res, chk.err);
  } else {
    var adbCon = adbRun('[cmd]', dev, q.cmd, function/*on_close*/(err) {
      end(res, !err ? '' : ((res.headersSent ? '\n' : '') + err));
    }, {timeout: (Number(q.timeout) || cfg['adbAdmCmdTimeout']) * 1000, log: q.log !== 'false'});
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
  new websocket.server({
    httpServer: (streamWeb ? [adminWeb, streamWeb] : [adminWeb]),
    maxReceivedFrameSize: 8 * 1024,
    maxReceivedMessageSize: 8 * 1024
  })
    .on('request', function (wsConReq) {
      var httpReq = wsConReq.httpRequest, httpTag = '[HTTP_' + (++httpSeq) + '] [WebSocket]';
      var parsedUrl = Url.parse(httpReq.url, true/*querystring*/), q = parsedUrl.query, urlPath = parsedUrl.pathname, dev;
      q.device && (httpTag += ' {' + q.device + '}');
      if (urlPath === '/adbBridge') {
        log(httpTag, 'REQ: ' + httpReq.url + (' [from ' + getHttpSourceAddresses(httpReq) + ']').replace(' [from localhost]', '') + (cfg.logHttpReqDetail ? ' [' + httpReq.headers['user-agent'] + ']' : '') + (cfg.logHttpReqDetail ? (' origin: ' + wsConReq.origin || '') : ''));
        if (!(dev = getDev(q, {chkAccessKey: true, connected: true, adbBridge: true}))) {
          log(httpTag, 'Rejected. Reason: ' + chk.err);
          return wsConReq.reject();
        }
        log(httpTag, 'Accepted as [AdbBridge.WEBSOCK] {' + dev.id + '}');
        dev.adbBridgeWebSocket && dev.adbBridgeWebSocket.__cleanup('new adbBridge is requested');
        dev.adbBridgeWebSocket = wsConReq.accept(null, wsConReq.origin);
        return handle_adbBridgeWebSocket_connection(dev, '[AdbBridge.WEBSOCK] {' + dev.id + '}');
      }
      else { //touch or keyboard
        cfg.logRdcWebSocketDetail && log(httpTag, 'REQ: ' + httpReq.url + (' [from ' + getHttpSourceAddresses(httpReq) + ']').replace(' [from localhost]', '') + (cfg.logHttpReqDetail ? ' [' + httpReq.headers['user-agent'] + ']' : '') + (cfg.logHttpReqDetail ? (' origin: ' + wsConReq.origin || '') : ''));
        if (!(dev = getDev(q, {chkAccessKey: true, connected: true, capturing: true}))) {
          cfg.logRdcWebSocketDetail && log(httpTag, 'Rejected. Reason: ' + chk.err);
          return wsConReq.reject();
        }
        cfg.logRdcWebSocketDetail && log(httpTag, 'Accepted as [RDC__' + httpSeq + ']');
        var rdcWebSocket = wsConReq.accept(null, wsConReq.origin);
        rdcWebSocket.devMapOfHandle = {};
        rdcWebSocket.devMapOfHandle[dev.i] = dev;
        dev.rdcWebSocketMap[rdcWebSocket.__id = getTimestamp()] = rdcWebSocket;
        return handle_rdcWebSocket_connection(rdcWebSocket, '[RDC__' + httpSeq + ']');
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
    (cfg.logAdbBridgeDetail || importantAdbCmdSet[cmd]) && log(tag, 'read  ' + cmd + '(' + hexUint32(arg0) + ', ' + hexUint32(arg1) + ') + ' + hexUint32(payloadBuf.length) + ' bytes' + (payloadBuf.length ? (': "' + payloadBuf.toString('ascii') + '"') : ''));

    if (cmd === 'CNXN') {
      bridge_write('CNXN', /*arg0:A_VERSION*/0x01000000, /*arg1:MAX_PAYLOAD*/0x00001000, new Buffer('device::ro.product.name=' + dev.info[5] + ';ro.product.model=' + dev.info[1] + ';ro.product.device=' + dev.info[6] + ';'));
    }
    else if (cmd === 'OPEN') {
      var serviceBuf = (payloadBuf[payloadBuf.length - 1] ? payloadBuf : payloadBuf.slice(0, -1)), total_okay_len = 0;
      arg1/*as localId*/ = (nextBackendId === 0xffffffff ? (nextBackendId = 1) : ++nextBackendId);

      backend = backend_create(/*localId:*/arg1, /*remoteId*/arg0, function /*on_connected*/() {
        cfg.logAdbBridgeDetail && log(backend.__tag, 'connection OK. ' + dev.adbHost + ' as backend ' + hexUint32(backend.__id));
        backend_write(backend, dev.buf_switchTransport);
      });

      backend.on('data', function (buf) {
        cfg.logAdbBridgeDetail && log(backend.__tag, 'read  ' + hexUint32(buf.length) + ' bytes: "' + buf.toString('ascii') + '"');
        if (total_okay_len < 8/*len of OKAYOKAY*/) {
          var okay_len = Math.min(buf.length, 4 - total_okay_len % 4), i;
          for (i = 0; i < okay_len; i++, total_okay_len++)
            if (buf[i] !== 'OKAY'.charCodeAt(total_okay_len % 4)) return backend_cleanup(backend, 'FAIL');
          if (total_okay_len !== 4 && total_okay_len !== 8) return;

          if (total_okay_len === 4/*len of OKAY*/) {
            return backend_write(backend, adbHost_makeBuf(serviceBuf));
          }
          bridge_write('OKAY', /*localId:*/arg1, /*remoteId:*/arg0, EMPTY_BUF);

          if (!(buf = buf.slice(okay_len)).length) return;
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
        bridge_write('OKAY', /*localId:*/arg1, /*remoteId:*/arg0, EMPTY_BUF);
      } else if (cmd === 'CLSE') {
        backend_cleanup(backend, 'CLSE requested');
      }
    }
  } //end of handle_adb_command

  function bridge_write(cmd, arg0, arg1, payloadBuf) {
    cfg.logAdbBridgeDetail && log(tag, 'write ' + cmd + '(' + hexUint32(arg0) + ', ' + hexUint32(arg1) + ') + ' + hexUint32(payloadBuf.length) + ' bytes' + (cfg.logAdbBridgeDetail ? (': "' + payloadBuf.toString('ascii') + '"') : ''));
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

  function backend_create(backendId, frontendId/*for peer id*/, on_connected) {
    var tag = '[AdbBridge.BACKEND] {' + dev.id + '}';
    var backend = net.connect(dev.adbHost, on_connected);

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
    reason !== 'CLSE requested' && bridge_write('CLSE', /*localId:*/0, /*remoteId:*/backend.__frontendId, EMPTY_BUF);
  }

  function backend_write(backend, buf) {
    cfg.logAdbBridgeDetail && log(backend.__tag, 'write ' + hexUint32(buf.length) + ' bytes: "' + buf.toString('ascii') + '"');
    backend.write(buf);
  }

  function cleanup(reason, detail) {
    if (cleanup.called) return;
    (cleanup.called = true) && log(tag, 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
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
    var devHandle, dev, _tag = tag;
    if (msg.type === 'utf8') {
      var match = msg.utf8Data.match(/^(\d+)([:<])([\s\S]+)$/);
      if (!match) { //treat as open_device request
        cfg.logRdcWebSocketDetail && log(_tag, 'open device: ' + JSON.stringify(msg.utf8Data));
        var parsedUrl = Url.parse(msg.utf8Data, true/*querystring*/), q = parsedUrl.query;
        q.device && (_tag += ' {' + q.device + '}');
        if (!(dev = getDev(q, {chkAccessKey: true, connected: true, capturing: true}))) {
          cfg.logRdcWebSocketDetail && log(_tag, chk.err);
          return ws.send(chk.err);
        }
        ws.devMapOfHandle[dev.i] = dev;
        dev.rdcWebSocketMap[ws.__id] = ws;

        cfg.logRdcWebSocketDetail && log(_tag, 'OK');
        return ws.send(String(dev.i));
      } //end of open_device request

      dev = ws.devMapOfHandle[devHandle = Number(match[1])];
      var isKeyCode = match[2] === ':', keyCodeOrText = match[3];
      cfg.logRdcWebSocketDetail && log((_tag += ' {' + (dev ? dev.id : '?#' + devHandle) + '}'), 'keybd: ' + JSON.stringify(keyCodeOrText) + (isKeyCode && keyNameMapOfCode[keyCodeOrText] ? ('(' + keyNameMapOfCode[keyCodeOrText] + ')') : ''));

      if (!sendKeybdEvent(dev, keyCodeOrText, isKeyCode)) {
        cfg.logRdcWebSocketDetail && log(_tag, chk.err);
        return ws.send(chk.err);
      }
      cfg.logRdcWebSocketDetail && log(_tag, 'OK');
    }
    else { //binary: touch event
      if (msg.binaryData.length !== 13) {
        return ws.send('invalid request');
      }
      dev = ws.devMapOfHandle[devHandle = msg.binaryData.readUInt32BE(0)];
      var type = String.fromCharCode(msg.binaryData.readUInt8(12)), x = msg.binaryData.readFloatBE(4), y = msg.binaryData.readFloatBE(8);
      cfg.logRdcWebSocketDetail && log((_tag += ' {' + (dev ? dev.id : '?#' + devHandle) + '}'), 'touch: ' + type + ' ' + x.toFixed(5) + ' ' + y.toFixed(5));

      if (!sendTouchEvent(dev, type, x, y)) {
        cfg.logRdcWebSocketDetail && log(_tag, chk.err);
        return ws.send(chk.err);
      }
      cfg.logRdcWebSocketDetail && log(_tag, 'OK');
    }
    return ws.send(''/*OK*/);
  });

  ws.__cleanup = cleanup;

  function cleanup(reason, detail) {
    if (cleanup.called) return;
    (cleanup.called = true) && cfg.logRdcWebSocketDetail && log(tag + ' {' + Object.keys(ws.devMapOfHandle).join('}, {') + '}', 'CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
    reason !== 'CLOSED' && ws.drop();

    forEachValueIn(ws.devMapOfHandle, function (dev) {
      delete dev.rdcWebSocketMap[ws.__id];
    });
    ws.devMapOfHandle = {};
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
  reloadPushFiles();
}

function reloadPushFiles() {
  pushContentMap = {};
  fileVer = fs.readdirSync(cfg.binDir).sort().reduce(function (hash, filename) {
    if (/^\./.test(filename)) return hash;
    var content = fs.readFileSync(cfg.binDir + '/' + filename), remotePath = cfg.androidWorkDir + '/' + filename.toLocaleLowerCase();
    pushContentMap[filename] = adbPreparePushFile(content, remotePath);
    return hash.update(content);
  }, crypto.createHash('md5')/*initial value*/).digest('hex');
}

reloadResource();

spawn('[CheckFfmpeg]', cfg['ffmpeg'], ['-version'], function/*on_close*/(err, stdout) {
  !/version/i.test(stdout) && process.stderr.write('Warning: failed to check FFMPEG (for this machine, not for Android device). You can not record video in H264/MP4 format.\nPlease install it from http://www.ffmpeg.org/download.html and add the ffmpeg\'s dir to PATH env var or set full path of ffmpeg to "ffmpeg" in config.json or your own config file.\n');
}, {timeout: 10 * 1000});

try {
  websocket = require('websocket');
} catch (e) {
}
!websocket && process.stderr.write('Warning: failed to check websocket lib. You will not be able to use some advanced function(i.e. AdbBridge via browser).\nYou can install it by command "nmp install websocket" or from "https://github.com/theturtle32/WebSocket-Node".\n');

adminWeb = cfg.adminWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync(cfg.adminWeb_cert)}, web_handler) : require('http').createServer(web_handler);
adminWeb.listen(cfg.adminWeb_port, cfg.adminWeb_ip === '*' ? undefined/*all ip4*/ : cfg.adminWeb_ip, function/*on_httpServerReady*/() {
  (!cfg.streamWeb_port ? passthrough : (streamWeb = cfg.streamWeb_protocol === 'https' ? require('https').createServer({pfx: fs.readFileSync(cfg.streamWeb_cert)}, web_handler) : require('http').createServer(web_handler)))
    .listen(cfg.streamWeb_port, cfg.streamWeb_ip === '*' ? undefined/*all ip4*/ : cfg.streamWeb_ip, function /*on_httpServerReady*/() {
      websocket && createWebSocketServer();
      initDeviceTrackers();
      process.stderr.write('OK. You can start from ' + cfg.adminWeb_protocol + '://localhost:' + cfg.adminWeb_port + '/' + (cfg.adminKey ? '?adminKey=' + querystring.escape(cfg.adminKey) : '') + '\n');
    });
});

//just to avoid compiler warning about undefined properties/methods
true === false && log({
  binDir: '',
  androidWorkDir: '',
  androidLogPath: '',
  streamWeb_ip: '',
  streamWeb_port: 0,
  streamWeb_protocol: '',
  streamWeb_cert: '',
  adminWeb_ip: '',
  adminWeb_port: 0,
  adminWeb_protocol: '',
  adminWeb_cert: '',
  outputDir: '',
  maxRecordTime: 0,
  adminUrlSuffix: '',
  viewSize: '',
  viewOrient: '',
  videoFileFrameRate: 0,
  __end: 0
});
true === false && log({
  showDisconnectedDevices: 0,
  logFfmpegDebugInfo: 0,
  logFpsStatistic: 0,
  fpsStatisticInterval: 0,
  logAllProcCmd: 0,
  logAllHttpReqRes: 0,
  logHttpReqDetail: 0,
  logAdbBridgeDetail: 0,
  logRdcWebSocketDetail: 0,
  __end: 0
});
true === false && log({
  keyCode: '',
  text: '',
  x: 0,
  y: 0,
  download: 0,
  cookie: '',
  range: '',
  orientation: '',
  logCondition: 0,
  _isSafari: 0,
  httpRequest: {},
  binaryData: {},
  accept: Function,
  reject: Function,
  pausable: 0,
  resumable: 0,
  __end: 0
});
