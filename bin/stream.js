'use strict';
process.chdir(__dirname); //set dir of current file as working dir

//************************import module  *************************************************
var child_process = require('child_process'),
    fs = require('fs'),
    url = require('url'),
    querystring = require('querystring'),
    jsonFile = require('./node_modules/jsonFile.js'),
    logger = require('./node_modules/logger.js');

var conf = jsonFile.parse('./stream.json');
if (!process) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
  conf = {adb: '', port: 0, ip: '', ssl: {on: false, certificateFilePath: ''}, adminWeb: {}, outputDir: '', maxRecordedFileSize: 0, ffmpegDebugLog: false, ffmpegStatistics: false, remoteLogAppend: false, logHttpReqAddr: false, reloadDevInfo: false, logAPNGProgress: false, forceUseFbFormat: false, ffmpegOption: {}};
}
var log = logger.create(conf ? conf.log : null);
log('===================================pid:' + process.pid + '=======================================');
if (!conf) {
  log(jsonFile.getLastError(), {stderr: true});
  process.exit(1);
}
log('use configuration: ' + JSON.stringify(conf, null, '  '));

//************************global var  ****************************************************
var MIN_FPS = 0.1, MAX_FPS = 30;
var UPLOAD_LOCAL_DIR = './android', ANDROID_WORK_DIR = '/data/local/tmp/sji-asc';
var PNG_TAIL_LEN = 8, APNG_CACHE_LEN = 6 * 1024 * 1024 + PNG_TAIL_LEN - 1; //still need be adjusted
var MULTIPART_BOUNDARY = 'MULTIPART_BOUNDARY', MULTIPART_MIXED_REPLACE = 'multipart/x-mixed-replace;boundary=' + MULTIPART_BOUNDARY;
var CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = BUF_CR2.slice(0, 1);
var re_adbNewLineSeq = /\r?\r?\n$/; // CR LF or CR CR LF
var devMgr = {}; //key:device serial number, value:device info. See getOrCreateDevCtx()
var chkerr = ''; //for chkerrXxx() to save error info 
var htmlCache = {}; //key:filename
var status = { consumerMap: {}};
var overallCounterMap = {streaming: null, recording: null, recorded: {bytes: 0}};
var recordingFileMap = {}; //key:filename
var childProcPidMap = {}; //key: pid
var videoTypeMap = {apng: {name: 'Animated PNG'}, webm: {name: 'WebM Video'}};
var imageTypeMap = {png: {name: 'PNG'}, jpg: {name: 'JPEG'}};
var videoAndImageTypeAry = Object.keys(videoTypeMap).concat(Object.keys(imageTypeMap));
var dynamicConfKeyList = ['ffmpegDebugLog', 'ffmpegStatistics', 'remoteLogAppend', 'logHttpReqAddr', 'reloadDevInfo', 'logAPNGProgress', 'forceUseFbFormat'];

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
    childProc.logHead = logHead.slice(0, -1) + ' @ pid_' + childProc.pid + ']';
    log(childProc.logHead + 'spawned');
  } else {
    log(childProc.logHead + 'spawn failed');
  }

  childProc.once('error', function (err) {
    if (err.code === 'ENOENT') {
      var hasDir = /[\/\\]/.test(_path);
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
      if (!childProc.__didGetStdoutData) {
        childProc.__didGetStdoutData = true;
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
  return err.toString().replace('EACCES', 'EACCES(access denied)').replace('ENOENT', 'ENOENT(not found)').replace('EADDRINUSE', 'EADDRINUSE(IP or port already in use)').replace(/\r*\n$/, '');
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
  return !s ? '' : s.replace(/\0/, '');
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

function nowStr() {
  var dt = new Date();
  if (dt.valueOf() === nowStr.dtMs) {
    nowStr.seq++;
  } else {
    nowStr.seq = 0;
    nowStr.dtMs = dt.valueOf();
  }
  return dpad4(dt.getFullYear()) + dpad2(dt.getMonth() + 1) + dpad2(dt.getDate()) + '_' + dpad2(dt.getHours()) + dpad2(dt.getMinutes()) + dpad2(dt.getSeconds()) + '_' + dpad3(dt.getMilliseconds()) + '_' + dpad3(nowStr.seq);
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
        if (value.every(function (el) {
          return !el && el !== 0;
        })) {
          return setchkerr(name + ' must not be an empty array');
        }
      } else {
        return setchkerr(name + ' must not be duplicated');
      }
    }
  }
  return '';
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

  var counter;
  if (res.filename) {
    if ((counter = res.counter)) {
      counter.bytes += dataStrOfBuf.length; //set recording bytes counter per device/type
    }
    if ((counter = overallCounterMap.recorded)) {
      counter.bytes += dataStrOfBuf.length; //set recorded bytes counter overall
    }
  } else if ((counter = overallCounterMap.streaming)) {
    counter.bytes += dataStrOfBuf.length; //set streaming bytes counter overall
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
  }
  if (res.logHead) {
    var s = dataStrOfBuf === undefined ? '' : String(dataStrOfBuf).replace(/\n[ \t]*/g, ' ');
    log(res.logHead + 'end' + (s ? (' with data: ' + (s.length > 50 ? s.slice(0, 50) + '...' : s)) : ''));
  }

  res.end(dataStrOfBuf);
}

function isAnyIp(ip) {
  return !ip || ip === '0.0.0.0' || ip === '*';
}

//****************************************************************************************

function checkAdb(on_complete) {
  spawn('[CheckAdb]', conf.adb, ['version'],
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr) {
          log('Failed to check Android Debug Bridge. Please check log', {stderr: true});
          process.exit(1);
        } else {
          on_complete();
        }
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
      'echo', '-n', '====;',
      'cat', ANDROID_WORK_DIR + '/version',
      (conf.remoteLogAppend ? '2>>' : '2>'), ANDROID_WORK_DIR + '/log', '`'),
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
      videoTypeMap[q.type] && chkerrRequired('fps', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS) ||
      imageTypeMap[q.type] && (q.fps = 0) && false ||
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
      type:    'apng' or 'webm' or 'png' or 'jpg'
      fps:     [optional] rate for webm and apng. must be in range MIN_FPS~MAX_FPS
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

  if (imageTypeMap[q.type]) {
    //for single image, it is light process, so let it coexistent with existing capture.
    provider = createCaptureProvider();
  } else {
    if (dev.liveStreamer && res.filename) { //stop other recording
      forEachValueIn(dev.liveStreamer.consumerMap, function (_res) {
        if (_res.filename) {
          endCaptureConsumer(_res, 'start another capture for recording');
        }
      });
    }
    if (dev.liveStreamer) { //there is an existing capture running or preparing
      if (dev.liveStreamer.type !== q.type || dev.liveStreamer.fps !== q.fps || dev.liveStreamer.scale !== q.scale || dev.liveStreamer.rotate !== q.rotate) {
        forEachValueIn(dev.liveStreamer.consumerMap, endCaptureConsumer, 'another live streamer is going to run');
        provider = dev.liveStreamer = createCaptureProvider();
      } else if (dev.liveStreamer.type === 'webm') {
        //theoretically WebM video stream can be broadcast to multiple client if fps is same,
        //but currently can not be analysed correctly, so this feature is not supported yet.
        //Specially, if no any consumer started output yet, it is possible to share the capture.
        if (Object.keys(dev.liveStreamer.consumerMap).some(function (consumerId) {
          return dev.liveStreamer.consumerMap[consumerId].__bytesWritten;
        })) {
          forEachValueIn(dev.liveStreamer.consumerMap, endCaptureConsumer, 'another live streamer is going to run');
          provider = dev.liveStreamer = createCaptureProvider();
        } else {
          provider = dev.liveStreamer;
        }
      } else {
        //Animated PNG image stream can be broadcast to multiple client if fps is same
        provider = dev.liveStreamer;
      }
    } else { //there is no existing capture running or preparing
      provider = dev.liveStreamer = createCaptureProvider();
    }
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
    res.setHeader('Content-Type', q.type === 'apng' ? MULTIPART_MIXED_REPLACE : imageTypeMap[q.type] ? 'image/' + q.type : 'video/' + q.type);
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

          var FFMPEG_PARAM = ' -r ' + (q.fps || 1) + ' ' + opt.in + ' -i -';
          if (conf.ffmpegStatistics !== true) {
            FFMPEG_PARAM += ' -nostats';
          }
          if (conf.ffmpegDebugLog === true) {
            FFMPEG_PARAM += ' -loglevel debug';
          }
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
              FFMPEG_PARAM += ' -vf ' + filter.slice(1);
            }
          }
          if (q.type === 'webm') { //webm video
            FFMPEG_PARAM += ' -f webm -vcodec libvpx -rc_lookahead 0 -qmin 0 -qmax 20 -b:v 1000k';
          } else if (q.type === 'apng') { //animated png image
            FFMPEG_PARAM += ' -f image2 -vcodec png -update 1';
          } else if (q.type === 'png') {    //single png image
            FFMPEG_PARAM += ' -f image2 -vcodec png -vframes 1';
          } else if (q.type === 'jpg') {    //single jpg image
            FFMPEG_PARAM += ' -f image2 -vcodec mjpeg -vframes 1';
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
            forEachValueIn(provider.consumerMap, function (res) {
              res.logHead = res.logHead.slice(0, -1) + ' @ pid_' + childProc.pid + ']';
            });
            provider.logHead = provider.logHead.slice(0, -1) + ' @ pid_' + childProc.pid + ']';

            childProc.stdout.on('data', function (buf) {
              convertCRLFToLF(provider/*context*/, dev.CrCount, buf).forEach(function (buf) {
                if (provider.type === 'apng') { //broadcast animated png image to multiple client
                  playANPGBuffer(provider/*context*/, provider.consumerMap, buf, 0, buf.length);
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
            if (provider === dev.liveStreamer) {
              log(provider.logHead + 'detach live streamer');
              dev.liveStreamer = null;
            }
            forEachValueIn(provider.consumerMap, endCaptureConsumer, res.__bytesWritten ? '' : 'capture process had internal error, exited without any output');
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

  endCaptureConsumer(provider.consumerMap[res.childConsumerId], 'parent consumer is closed');

  if (provider === provider.dev.liveStreamer && Object.keys(provider.consumerMap).length === 0) {
    if (provider.pid) {
      log(provider.logHead + 'kill this live streamer process due to no more consumer');
      try {
        process.kill(provider.pid);
      } catch (err) {
        log('failed to kill process pid_' + provider.pid + '. ' + stringifyError(err));
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
        wfile.logHead = '[FileWriter(Record) ' + filename + ']';
        wfile.filename = filename;

        wfile.on('open', function () {
          log(wfile.logHead + 'opened for write');
          recordingFileMap[filename] = true;
          capture(wfile, q); //-----------------------------------capture to file---------------------------------------
          callbackOnce('', wfile);
        });
        wfile.on('close', function () { //file's 'close' event will always be fired. If have pending output, it will be fired after 'finish' event which means flushed.
          wfile.__isClosed = true;
          log(wfile.logHead + 'closed');
          delete recordingFileMap[filename];
          callbackOnce('recording is stopped'); //do not worry, normally 'open' event handler have cleared this callback
          if (process.toBeExited && Object.keys(recordingFileMap).length === 0) {
            log('all files have been flushed. Now exit');
            process.exit(0);
          }
        });
        wfile.on('error', function (err) {
          log(wfile.logHead + stringifyError(err));
          callbackOnce(err.code === 'ENOENT' ? 'error: output dir not found' : 'file operation error ' + err.code);
        });
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
      type:    'apng' or 'webm'
      fileIndex: [optional] number or timestamp like 20140110_153928_704_000.
                Bigger number means older file. E.g. 1 means 1 generation older file.
      fps:     [optional] rate for apng only. must be in range MIN_FPS~MAX_FPS
    }
 * @param forDownload  true/false
 */
function playOrDownloadRecordedFile(httpOutputStream, q, forDownload/*optional*/) {
  findFiles(q.device, q.type, function /*on_complete*/(err, filenameAry) {
    var res = httpOutputStream, filename;
    if (err || !(filename = filenameAry[q.fileIndex || 0])) {
      return end(res, err || 'file not found');
    }
    if (!q.fps) {
      q.fps = Number(filename.slice(querystring.escape(q.device).length + '~' + q.type + '~f'.length).match(/^[0-9.]+/));
      if (chkerrRequired('fps', q.fps, MIN_FPS, MAX_FPS)) {
        return end(res, err || 'bad file name');
      }
    }

    var rfile = fs.createReadStream(conf.outputDir + '/' + filename);
    rfile.logHead = '[FileReader(' + (forDownload ? 'Download' : 'Play') + ' ' + filename + ']';
    res.logHead = res.logHead.slice(0, -1) + ' @ ' + rfile.logHead.slice(1, -1) + ']';

    rfile.on('open', function (fd) {
      log(rfile.logHead + 'opened for read');
      fs.fstat(fd, function/*on_complete*/(err, stats) {
        if (err) {
          log(rfile.logHead + 'fstat ' + err);
          end(res, 'file operation error ' + err.code);
          rfile.close(); //stop reading more
          return;
        }
        res.setHeader('Content-Type', (q.type === 'apng' && !forDownload) ? MULTIPART_MIXED_REPLACE : 'video/' + q.type);
        if (forDownload) {
          res.setHeader('Content-Disposition', 'attachment;filename=asc~' + filename + '.' + q.type);
          res.setHeader('Content-Length', stats.size);
        } else if (q.type === 'apng') {
          rfile.frameIndex = 0;
          rfile.startTimeMs = Date.now();
        }
        updateCounter(q.device, q.type, +1, res/*ownerOutputStream*/);

        rfile.on('data', function (buf) {
          if (forDownload) {
            write(res, buf);
          } else if (q.type === 'apng') { //play apng specially, translate it to multipart output
            playANPGBuffer(rfile/*context*/, [res], buf, 0, buf.length, on_complete1Png);
          } else { //for normal video, just write content
            write(res, buf);
          }

          function on_complete1Png(pos/*next png start position*/) {
            if (conf.logAPNGProgress) {
              log(rfile.logHead + 'frame ' + rfile.frameIndex + ' completed' + ((rfile.noMoreData && pos >= buf.length) ? '(last)' : ''));
            }
            if (pos < buf.length || !rfile.noMoreData) { //if have rest data
              //write next content-type early to force Chrome draw previous image immediately.
              //For last image, do not write next content-type head because it cause last image view invalidated.
              write(res, '\n--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/png\n\n');
              rfile.frameIndex++;
              rfile.pause();
              rfile.timer = setTimeout(function () {
                rfile.resume();
                rfile.timer = null;
                playANPGBuffer(rfile/*context*/, [res], buf, pos, buf.length, on_complete1Png);
                if (!rfile.timer && rfile.noMoreData) {
                  end(res);
                }
              }, Math.max(1, (rfile.startTimeMs + rfile.frameIndex * 1000 / q.fps) - Date.now()));
            }
          }
        }); //end of 'data' event handler

        rfile.on('end', function () {
          log(rfile.logHead + 'read end');
          if (!rfile.timer) {
            end(res);
          }
          rfile.noMoreData = true;
        });
      }); //end of on_complete of fstat
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
    });
    res.on('finish', function () { //data have been flushed. This event is not related with 'close' event
      updateCounter(q.device, q.type, -1, res/*ownerOutputStream*/);
    });
    return ''; //just to avoid compiler warning
  });
}

function findFiles(device/*optional*/, type/*optional*/, on_complete) {
  var devAry = !device ? null : Array.isArray(device) ? device : [device];
  var typeAry = !type ? null : Array.isArray(type) ? type : [type];

  fs.readdir(conf.outputDir, function (err, filenameAry) {
    if (err) {
      log('[FindFiles]readdir ' + stringifyError(err));
      return on_complete(err.code === 'ENOENT' ? 'error: output dir not found' : 'file operation error ' + err.code, []);
    }

    filenameAry = filenameAry.filter(function (filename) {
      var parts = filename.split('~');
      if (parts.length !== 4) {
        return false;
      }
      if (recordingFileMap[filename]) {
        return false;
      }
      return (!devAry || devAry.indexOf(querystring.unescape(parts[0])) >= 0) && (!typeAry || typeAry.indexOf(parts[1]) >= 0);
    });

    //sort by time (newer first)
    filenameAry.sort(function (a, b) {
      a = a.slice(-nowStr.LEN);
      b = b.slice(-nowStr.LEN);
      return (a < b) ? 1 : (a > b) ? -1 : 0;
    });

    //make it searchable by fileIndex (timestamp)
    filenameAry.forEach(function (filename) {
      filenameAry[filename.slice(-nowStr.LEN)] = filename;
    });

    if (filenameAry.length) {
      getOrCreateDevCtx(device); //ensure having created device context
    }
    return on_complete('', filenameAry);
  });
}

//if fileIndex querystring is specified(can be empty string) then delete single file, otherwise delete all files of the type
function deleteFiles(device/*optional*/, type/*optional*/, fileIndex/*optional*/) {
  findFiles(device, type, function /*on_complete*/(err, filenameAry) {
    (fileIndex === undefined ? filenameAry : [filenameAry[fileIndex]]).forEach(function (filename) {
      try {
        fs.unlinkSync(conf.outputDir + '/' + filename);
      } catch (err) {
        log('failed to delete file ' + conf.outputDir + '/' + filename + '. ' + stringifyError(err));
      }
    });
    loadResourceSync();
  });
}

function updateCounter(device, type, delta, res/*ownerOutputStream*/) {
  var dev = devMgr[device], counter, counterType = res.filename ? 'recording' : 'streaming';

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
    res.counter = dev.counterMapRoot[type][counterType] = null;
  }
  setTimeout(pushStatus, 0);
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

  //set individual counter. res.counter.bytes will be set by write(res,...)
  forEachValueIn(devMgr, function (dev, device) {
    forEachValueIn(dev.counterMapRoot, function (counterMap, type) {
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

/*
 * write animated png stream to all consumers
 */
function playANPGBuffer(context, consumerMap, buf, pos, endPos, on_complete1Png /*optional*/) {
  if (pos >= endPos) {
    return;
  }
  if (!context.pngCacheLength) {
    //mark each consumer's start flag
    forEachValueIn(consumerMap, __startPNG);

    context.pngCacheLength = 0;
    if (!context.pngCache) {
      context.pngCache = new Buffer(APNG_CACHE_LEN);
      if (conf.logAPNGProgress) {
        context.pngIndex = context.pngIndex === undefined ? 0 : context.pngIndex + 1;
      }
    }
  }

  for (; pos < endPos; pos++) {
    context.pngCache[context.pngCacheLength++] = buf[pos];
    /*
     * find tail
     */
    if (__isPngTail(context.pngCache, context.pngCacheLength - PNG_TAIL_LEN)) {
      //ok, png complete, write last part
      forEachValueIn(consumerMap, __writeCache);

      //reset parser
      context.pngCacheLength = 0;
      pos++;

      if (on_complete1Png) {
        on_complete1Png(pos);
      } else {
        forEachValueIn(consumerMap, __complete1Png);
        playANPGBuffer(context, consumerMap, buf, pos, endPos);
      }

      break;
    }
    /*
     * find body
     */
    else if (context.pngCacheLength === APNG_CACHE_LEN) {
      if (conf.logAPNGProgress) {
        log('png cache full');
      }
      //move some pngCache data to output stream if big enough
      context.pngCacheLength = APNG_CACHE_LEN - (PNG_TAIL_LEN - 1);
      forEachValueIn(consumerMap, __writeCache);
      //copy last PNG_TAIL_LEN-1 byte to head
      context.pngCache.copy(context.pngCache, 0, APNG_CACHE_LEN - (PNG_TAIL_LEN - 1));
      context.pngCacheLength = PNG_TAIL_LEN - 1;
    }
  }

  function __writeCache(res) {
    if (res.isAPNGStarted) {
      write(res, context.pngCache.slice(0, context.pngCacheLength));

      if (conf.logAPNGProgress) {
        var filename = (res.filename ? res.filename + '_write' : context.filename ? context.filename + '_read' : 'http_write') + '_png_' + context.pngIndex + '.png';
        log(filename + ' length ' + context.pngCacheLength);
        fs.createWriteStream(conf.outputDir + '/' + filename).end(context.pngCache.slice(0, context.pngCacheLength));
      }
    }
  }

  function __isPngTail(buf, i/*position*/) {
    return (buf[i++] === 0x49 && buf[i++] === 0x45 && buf[i++] === 0x4E && buf[i++] === 0x44 && buf[i++] === 0xAE && buf[i++] === 0x42 && buf[i++] === 0x60 && buf[i] === 0x82);
  }

  function __startPNG(res) {
    if (!res.isAPNGStarted && res.setHeader) { //animated png
      write(res, '--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/png\n\n');
    }
    res.isAPNGStarted = true;
  }

  function __complete1Png(res) {
    if (res.isAPNGStarted && res.setHeader) {
      //write next content-type early to force Chrome draw previous image immediately.
      write(res, '\n--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/png\n\n');
    }
  }
} //end of playANPGBuffer()

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

function startStreamWeb() {
  var httpServer, httpSeq = 0, _isAnyIp = isAnyIp(conf.ip), smark = (conf.ssl.on ? 's' : '');
  conf.ipForHtmlLink = (isAnyIp(conf.ip) ? '127.0.0.1' : conf.ip);
  if (conf.ssl.on) {
    log('load SSL server certificate and private key from PKCS12 file: ' + conf.ssl.certificateFilePath);
    var options = {pfx: fs.readFileSync(conf.ssl.certificateFilePath)};
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
      q = {device: '', accessKey: '', type: '', fps: 0, scale: 0, rotate: 0, recordOption: '', fileIndex: ''};
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
        res.logHead = '[HTTP' + smark.toUpperCase() + '#' + (res.seq = ++httpSeq) + ']';
        log(res.logHead.slice(0, -1) + (conf.logHttpReqAddr ? ' ' + req.connection.remoteAddress + ':' + req.connection.remotePort : '') + ' ' + req.url + ' ]' + 'begin');
        res.on('close', function () { //closed without normal end(res,...)
          res.__isClosed = true;
          log(res.logHead + 'closed by peer');
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
        if (chkerrRequired('type', q.type, Object.keys(videoTypeMap)) ||
            q.type === 'apng' && chkerrOptional('fps(optional)', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS)) {
          return end(res, chkerr);
        }
        playOrDownloadRecordedFile(res, q, false/*forPlay*/);
        break;
      case '/downloadRecordedFile': //---------------------download recorded file---------------------------------------
        if (chkerrRequired('type', q.type, Object.keys(videoTypeMap))) {
          return end(res, chkerr);
        }
        playOrDownloadRecordedFile(res, q, true/*forDownload*/);
        break;
      case '/liveViewer':  //------------------------------show live capture (Just as a sample) ------------------------
        if (chkerrCaptureParameter(q) ||
            q.type === 'webm' && chkerrOptional('recordOption(optional)', q.recordOption, ['sync', 'async'])) {
          return end(res, chkerr);
        }
        prepareDeviceFile(q.device, function /*on_complete*/(err) {
              if (err) {
                return end(res, err);
              }
              res.setHeader('Content-Type', 'text/html');
              return end(res, htmlCache[q.type + '_liveViewer.html'] //this html will in turn open URL /playRecordedFile?....
                  .replace(/@device\b/g, querystring.escape(q.device))
                  .replace(/#device\b/g, htmlEncode(q.device))
                  .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
                  .replace(/#accessKey\b/g, htmlEncode(q.accessKey || ''))
                  .replace(/@type\b/g, q.type)
                  .replace(/#typeDisp\b/g, htmlEncode(videoTypeMap[q.type].name))
                  .replace(/@stream_web\b/g, 'http' + smark + '://' + req.headers.host)// http[s]://host:port
                  .replace(/@MIN_FPS\b/g, MIN_FPS)
                  .replace(/@MAX_FPS\b/g, MAX_FPS)
                  .replace(/@fps\b/g, q.fps)
                  .replace(/@scale\b/g, q.scale)
                  .replace(/@rotate\b/g, q.rotate)
                  .replace(new RegExp('name="rotate" value="' + q.rotate + '"', 'g'), '$& checked')  //set check mark
                  .replace(new RegExp('name="recordOption" value="' + (q.recordOption || '') + '"', 'g'), '$& checked') //set check mark
              );
            }
        );
        break;
      case '/fileViewer':  //---------------------------show recorded file  (Just as a sample)--------------------------
        if (chkerrRequired('type', q.type, Object.keys(videoTypeMap)) ||
            q.type === 'apng' && chkerrOptional('fps(optional)', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS)) {
          return end(res, chkerr);
        }
        findFiles(q.device, q.type, function/*on_complete*/(err, filenameAry) {
          var filename, absFileIndex, relFileIndex;
          if (err || !(filename = filenameAry[q.fileIndex || 0])) {
            return end(res, err || 'file not found');
          }
          q.fileIndex = absFileIndex = filename.slice(-nowStr.LEN);
          relFileIndex = filenameAry.indexOf(filename);

          res.setHeader('Content-Type', 'text/html');
          return end(res, htmlCache[q.type + '_fileViewer.html'] //this html will in turn open URL /playRecordedFile?....
              .replace(/@device\b/g, querystring.escape(q.device))
              .replace(/#device\b/g, htmlEncode(q.device))
              .replace(/@accessKey\b/g, querystring.escape(q.accessKey || ''))
              .replace(/#accessKey\b/g, htmlEncode(q.accessKey || ''))
              .replace(/@type\b/g, q.type)
              .replace(/#typeDisp\b/g, htmlEncode(videoTypeMap[q.type].name))
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
          );
        });
        break;
      case '/saveImage': //--------------------------------save image from recorded file -------------------------------
        break;
      default:
        end(res, 'bad request');
    }
    return ''; //just to avoid compiler warning
  }
}

function startAdminWeb() {
  var httpServer, httpSeq = 0, _isAnyIp = isAnyIp(conf.adminWeb.ip), smark = (conf.adminWeb.ssl.on ? 's' : '');
  if (conf.adminWeb.ssl.on) {
    log('load SSL server certificate and private key from PKCS12 file: ' + conf.adminWeb.ssl.certificateFilePath);
    var options = {pfx: fs.readFileSync(conf.adminWeb.ssl.certificateFilePath)};
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
      q = {adminKey: '', device: [], accessKey: '', type: '', fps: 0, scale: 0, rotate: 0, action: '', logDate: '', logDownload: '', logStart: '', logEnd: ''};
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
        res.logHead = '[AdminHTTP' + smark.toUpperCase() + '#' + (res.seq = ++httpSeq) + ']';
        log(res.logHead.slice(0, -1) + ' ' + req.url + ' ]' + 'begin');

        res.on('close', function () { //closed without normal end(res,...)
          res.__isClosed = true;
          log(res.logHead + 'closed by peer');
        });
    }

    setDefaultHttpHeader(res);

    switch (parsedUrl.pathname) {
      case '/deviceControl': //----------------------------control multiple devices-------------------------------------
        if (chkerrRequired('device[]', q.device)) {
          return end(res, chkerr);
        }
        switch (q.action) {
          case 'setAccessKey': //----------------------------set access key for multiple devices------------------------
          case 'unsetAccessKey': //--------------------------unset access key for multiple devices----------------------
            if (q.action === 'setAccessKey' && chkerrRequired('accessKey', q.accessKey)) {
              return end(res, chkerr);
            }
            uniqueNonEmptyArray(q.device).forEach(function (device) {
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
            uniqueNonEmptyArray(q.device).forEach(function (device, i, devAry) {
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
                      okAry.push((devAry.length > 1 ? device + ' OK: ' : 'OK: ') + wfile.filename.slice(-nowStr.LEN));
                    }
                    if (errAry.length + okAry.length === devAry.length) { //loop completed, now write response
                      end(res, okAry.concat(errAry).join('\n'));
                    }
                  }
              );
            });
            break;
          case 'stopRecording': //----------------------------stop recording for multiple devices-----------------------
            if (chkerrOptional('type(optional)', q.type, Object.keys(videoTypeMap))) {
              return end(res, chkerr);
            }
            uniqueNonEmptyArray(q.device).forEach(function (device) {
              if (devMgr[device] && devMgr[device].liveStreamer) {
                forEachValueIn(devMgr[device].liveStreamer.consumerMap, function (res) {
                  if (res.filename && (!q.type || devMgr[device].liveStreamer.type === q.type)) {
                    endCaptureConsumer(res, 'stop recording');
                  }
                });
              }
            });
            end(res, 'OK');
            break;
          case 'deleteRecordedFiles': //---------------------delete recorded files for multiple devices-----------------
            if (chkerrRequired('type', q.type, Object.keys(videoTypeMap))) {
              return end(res, chkerr);
            }
            deleteFiles(q.device, q.type, q.fileIndex);
            end(res, 'OK');
            break;
          case 'deleteImages': //--------------------------delete image files for multiple devices----------------------
            deleteFiles(q.device, Object.keys(imageTypeMap), q.fileIndex);
            end(res, 'OK');
            break;
          default :
            return end(res, 'bad request');
        }
        break;
      case '/getDeviceLog':  //--------------------------------get internal log file----------------------------------
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
        q.type = q.type || 'apng';
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
                      .replace(/#devinfo_class\b/g, htmlEncode(dev.info ? '' : 'errorWithTip'))
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
        Object.keys(childProcPidMap).forEach(function (pid) {
          log('kill child process pid_' + pid);
          try {
            process.kill(pid);
          } catch (err) {
            log('failed to kill process pid_' + pid + '. ' + stringifyError(err));
          }
        });
        setTimeout(function () {
          if (Object.keys(recordingFileMap).length) {
            log('there are ' + Object.keys(recordingFileMap).length + ' recording files have not been flushed. Wait...');
            process.toBeExited = true; //let 'close' event handler of recording file to do the check
          } else {
            log('no problem. Now exit');
            process.exit(0);
          }
        }, 10);
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

        conf.logStart = q.logStart;
        conf.logEnd = q.logEnd;

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
                  if (req.headers.referer) {
                    res.writeHead(302, {Location: req.headers.referer});
                  }
                  if (okAry.length) {
                    status.appVer = nowStr();
                    setTimeout(pushStatusForAppVer, 50);
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
  fs.readdirSync(conf.outputDir).forEach(function (filename) {
    var parts = filename.split('~');
    if (parts.length === 4) {
      getOrCreateDevCtx(querystring.unescape(parts[0])/*device serial number*/);
      overallCounterMap.recorded.bytes += fs.statSync(conf.outputDir + '/' + filename).size;
    }
  });

  status.appVer = nowStr();
  pushStatusForAppVer();
}

checkAdb(
    function/*on_complete*/() {
      startAdminWeb();
      startStreamWeb();
      loadResourceSync();
    });

//done: refactor source
//done: use configuration file (stream.json)
//done: support SSL
//done: use pfx format for server certificate and private key
//done: support browser's javascript XMLHttpRequest
//done: disable ffmpeg statistics log by default
//done: admin web site
//done: session management
//done: test: stop recording
//done: do not call getRemoteVer every time
//done: resize in android
//done: rotate in android
//done: play recorded file( webm )
//done: play recorded file( apng )
//done: test: record webm video and record at same time
//done: stress test replay apng
//done: sort recorded file by time
//done: memory leak test on repeatedly view recorded file and view live capture
//done: Fixed: Force firefox/safari refresh page when history back
//done: check device existence for liveViewer request
//done: stress test live capture (animated PNG)
//done: stress test live capture (webm)
//done: test close http stream when downloading or playing
//done: do not show recording file, only show latest recorded file
//done: check device availability first in /fileViewer or /liveViewer
//done: show streamer in menu page
//done: resize and rotate locally by html css3
//done: add conf.maxRecordedFileSize limitation
//done: support replay specified recorded file by fileIndex querystring( in number format or string format like 20140110_153928_704_000)
//done: support view android cpu and memory usage

//done: push status to browser
//done: main: show download log file link
//done: recorded file viewer: show previous, next recorded file link
//done: recorded file viewer: show absolute fileIndex (timestamp)
//done: recorded file viewer: show download link
//done: test: wait until all files have been flushed when exit
//done: enable use different stream web ip for all concerned links in menu page. (From AdminTool)
//done: close all children processes when exit
//done: prevent multiple recording on same device
//done: comparing file hash to check whether need upload to android
//done: jsonFile: remove tail comment
//done: local scale and rotate work together
//done: push notification to admin browsers when server restart or internal configuration changes
//done: AdminTool: provide a link button to forcibly upload files to all connected devices.
//done: menu page should mask UI when server is not reachable

//todo: some device crashes if live view full image
//todo: sometimes ScreenshotClient::update just failed
//todo: remove zero size file
//todo: should use busybox to compute file hash
//todo: ffmpeg log enhance
//todo: ffmpeg pipe seems only accept max 8359936 bytes. 01/28 18:54:39.022983[pid_16484][get-raw-image]write result:8359936 < requested 8847360. Continue writing rest data
//todo: close existing ffmpeg processes in android by busybox
//todo: get-raw-image write error: no such file or directory. Maybe need split write to multiple times.
//todo: create shell script to start this application, download ffmpeg bin
//todo: use "for ever" tool to start this server
//todo: some device screen capture color confused
//todo: show saved image in apng viewer
//todo: enable save some image on server when in live viewing or recording
//todo: apng stream split logic  (Firefox failed to play recorded file some times)
//todo: recording should not write partial png out
//todo: IE does not support <button> inside <a>
//todo: test: on Windows OS, IE again
//todo: convert apng to mp4 so can control progress by viewer
//todo: safari: multipart/x-mixed-replace
//todo: join two webm file
//todo: enable webm live viewing and recording at same time. Completely remove recordOption when liveViewer
//todo: adapt fps change without interrupting viewer
//todo: use error image or video to show error
//todo: water mark
//todo: add audio
//todo: make touchable: forward motion event to android
//todo: remove dependence of adb
