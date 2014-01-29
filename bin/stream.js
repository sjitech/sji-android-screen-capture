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
  conf = {adb: '', port: 0, ip: '', ssl: {on: false, certificateFilePath: ''}, adminWeb: {}, outputDir: '', maxRecordedFileSize: 0, supportXmlHttpRequest: false, ffmpegStatistics: false, remoteLogAppend: false, logHttpReqAddr: false, reloadDevInfo: false, logAPNGProgress: false, logStreamWrite: false};
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
var PNG_TAIL_LEN = 8, APNG_CACHE_LEN = 6 * 1024 * 1024 + PNG_TAIL_LEN - 1; //todo: restore
var MULTIPART_BOUNDARY = 'MULTIPART_BOUNDARY', MULTIPART_MIXED_REPLACE = 'multipart/x-mixed-replace;boundary=' + MULTIPART_BOUNDARY;
var CR = 0xd, LF = 0xa, BUF_CR2 = new Buffer([CR, CR]), BUF_CR = BUF_CR2.slice(0, 1);
var re_adbNewLineSeq = /\r?\r?\n$/; // CR LF or CR CR LF
var devMgr = {}; //key:device serial number, value:device info
var chkerr = '';
var htmlCache = {};
var dynamicConfKeyList = ['ffmpegStatistics', 'remoteLogAppend', 'logHttpReqAddr', 'reloadDevInfo', 'logAPNGProgress', 'logStreamWrite'];

//************************common *********************************************************
function spawn(logHead, _path, args, on_close, opt) {
  log(logHead + 'spawn ' + _path + ' with args: ' + JSON.stringify(args));

  var childProc = child_process.spawn(_path, args);

  childProc.logHead = (logHead.slice(-1) === ']' ? logHead.slice(0, -1) : logHead) + ' pid#' + childProc.pid + ']';
  log(childProc.logHead + 'spawned');

  childProc.once('error', function (err) {
    if (err.code === 'ENOENT') {
      var hasDir = /[\/\\]/.test(_path);
      var hint = hasDir ? '' : ', Please use full path or add dir of file to PATH env var';
      err = 'Error ENOENT(file is not found' + (hasDir ? '' : ' in dir list defined by PATH environment variable') + '). File: ' + _path + hint;
    } else if (err.code === 'EACCES') {
      err = 'Error EACCES(file is not executable or you have no permission to execute). File: ' + _path;
    }
    log(childProc.logHead + err);
  });
  childProc.once('close', function (ret, signal) {
    log(childProc.logHead + 'exited: ' + (ret || '') + ' ' + (signal || ''));
  });
  if (typeof(on_close) === 'function') {
    var stdoutBufAry = [];
    childProc.stdout.on('data', function (buf) {
      stdoutBufAry.push(buf);
      if (opt && opt.noLogStdout === true) {
        if (!childProc.didOmittedStdout) {
          childProc.didOmittedStdout = true;
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
    childProc.once('close', function (ret) {
      var stdout = Buffer.concat(stdoutBufAry).toString();
      stdoutBufAry = null;
      var stderr = Buffer.concat(stderrBufAry).toString();
      stderrBufAry = null;
      on_close(ret, stdout, stderr);
    });
  }
  return childProc;
}

function beautifyErrMsg(err) {
  return err.toString().replace('EACCES', 'EACCES(access denied)').replace('ENOENT', 'ENOENT(not found)').replace('EADDRINUSE', 'EADDRINUSE(ip:port already in use)').replace(/\r*\n$/, '');
}

function beautifyStderr(stderr) {
  return stderr.replace(/^error: */i, '').replace(/\r*\n$/, '');
}

function htmlEncode(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uniqueNonEmptyArray(ary) {
  return ary.reduce(function (p, c) {
    if (c && p.indexOf(c) < 0) {
      p.push(c);
    }
    return p;
  }, []);
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
  if (dt === nowStr.dt) {
    nowStr.seq++;
  } else {
    nowStr.seq = 0;
    nowStr.dt = dt;
  }
  return dpad4(dt.getFullYear()) + dpad2(dt.getMonth() + 1) + dpad2(dt.getDate()) + '_' + dpad2(dt.getHours()) + dpad2(dt.getMinutes()) + dpad2(dt.getSeconds()) + '_' + dpad3(dt.getMilliseconds()) + '_' + dpad3(nowStr.seq);
}
nowStr.LEN = nowStr().length;

function setchkerr(err) {
  chkerr = err;
  return chkerr;
}

function chkerrRequired(name, value /*candidateArray | candidateValue | candidateMinValue, candidateMaxValue*/) {
  var canBeArray = false;
  if (name.slice(-2) === '[]') {
    canBeArray = true;
    name = name.slice(0, -2);
  }
  if (arguments.length === 3) { //check against array
    if (value === undefined || (Array.isArray(arguments[2]) ? arguments[2] : [arguments[2]]).indexOf(value) < 0) {
      return setchkerr(name + ' parameter must be in ' + JSON.stringify(arguments[2]));
    }
  } else if (arguments.length === 4) { //check against range
    if (value === undefined || !(value >= arguments[2] && value <= arguments[3])) { //do not use v < min || v > max due to NaN always cause false
      return setchkerr(name + ' parameter must be in (' + arguments[2] + ' ~ ' + arguments[3] + ')');
    }
  } else { //check required only
    if (!value) {
      return setchkerr(name + ' parameter must be specified');
    }
    if (Array.isArray(value)) { //check array type value
      if (canBeArray) {
        if (value.every(function (el) {
          return !el && el !== 0;
        })) {
          return setchkerr(name + ' parameter is an empty array');
        }
      } else {
        return setchkerr(name + ' parameter is duplicated');
      }
    }
  }
  return '';
}

function chkerrOptional(name, value /*,arrayOrMinValue, maxValue*/) {
  return value ? chkerrRequired.apply(null, arguments) : '';
}

function write(res, dataStrOfBuf) {
  if (!res.didWrite) {
    res.didWrite = true;
    log((res.logHead || '') + 'start output......');
  }

  if (conf.logStreamWrite && !res.isAdminWeb) {
    log(res.logHead + 'output ' + dataStrOfBuf.length + ' bytes');
  }

  res.write(dataStrOfBuf);

  if (res.filename) { //FileRecorder
    res.fileSize = (res.fileSize || 0) + dataStrOfBuf.length;
    if (res.fileSize >= conf.maxRecordedFileSize) {
      log(res.logHead + 'stop recording due to size too big');
      end(res);
    }
  }
}

function end(res, dataStrOfBuf) {
  if (res.didWrite) {
    dataStrOfBuf = '';
  } else {
    if (res.setHeader && !res.headersSent && (res.getHeader('Content-Type') || '').slice(0, 5) !== 'text/') {
      res.setHeader('Content-Type', 'text/plain');
    }
  }
  var s = dataStrOfBuf === undefined ? '' : String(dataStrOfBuf).replace(/\n[ \t]*/g, ' ');
  log((res.logHead || '') + 'end' + (s ? (': ' + (s.length > 50 ? s.slice(0, 50) + '...' : s)) : ''));
  res.end(dataStrOfBuf);
}

function isAnyIp(ip) {
  return !ip || ip === '0.0.0.0' || ip === '*';
}

//****************************************************************************************

function checkAdb(on_ok) {
  spawn('[checkAdb]', conf.adb, ['version'],
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr) {
          log('Failed to check Android Debug Bridge. Please check log', {stderr: true});
          process.exit(1);
        } else {
          on_ok();
        }
      });
}

function getAllDev(on_ok, on_error) {
  spawn('[getAllDev]', conf.adb, ['devices'],
      function /*on_close*/(ret, stdout, stderr) {
        if (ret !== 0 || stderr) {
          return on_error(stderr ? beautifyStderr(stderr) : 'getAllDev error');
        }
        var deviceList = [], parts;
        stdout.split('\n').slice(1/*from second line*/).forEach(function (lineStr) {
          if ((parts = lineStr.split('\t')).length > 1) {
            deviceList.push(parts[0]);
          }
        });
        return on_ok(deviceList);
      });
}

function getDevInfo(device, on_complete, timeoutMs) {
  if (!conf.reloadDevInfo && devMgr[device] && devMgr[device].info) {
    on_complete('', devMgr[device].info);
    return;
  }
  var childProc = spawn('[getDevInfo]', conf.adb, ['-s', device, 'shell', 'echo', '`',
    'getprop', 'ro.product.model;',
    'getprop', 'ro.build.version.incremental;',
    'getprop', 'ro.product.manufacturer;',
    'getprop', 'ro.build.version.release;',
    'getprop', 'ro.build.version.sdk;',
    'getprop', 'ro.product.cpu.abi;',
    '`'],
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
  getAllDev(
      function/*on_ok*/(deviceList) {
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
      },
      on_complete/*on_error*/);
}

/*
 * upload all necessary files to android
 */
function uploadFile(device, on_ok, on_error) {
  if (!devMgr[device]) {
    devMgr[device] = {};
  }
  if (devMgr[device].uploaded) {
    on_ok();
  } else {
    spawn('[getRemoteVer]', conf.adb, ['-s', device, 'shell', 'cat', ANDROID_WORK_DIR + '/version'],
        function /*on_close*/(ret, stdout, stderr) {
          if (ret !== 0 || stderr) {
            on_error(stderr ? beautifyStderr(stderr) : 'getRemoteVer error');
          } else {
            // BTW, detect new line sequence returned by adb
            devMgr[device].CrCount = stdout.match(re_adbNewLineSeq)[0].length - 1/*LF*/ - 1/*another CR will be removed by stty -oncr*/;
            if (stdout.replace(re_adbNewLineSeq, '') === uploadFile.ver) {
              devMgr[device].uploaded = true;
              on_ok();
            } else {
              spawn('[uploadFile]', conf.adb, ['-s', device , 'push', UPLOAD_LOCAL_DIR, ANDROID_WORK_DIR],
                  function /*on_close*/(ret, stdout, stderr) {
                    if (ret !== 0) {
                      on_error(stderr ? beautifyStderr(stderr) : 'uploadFile error');
                    } else {
                      spawn('[updateRemoteVer]', conf.adb, ['-s', device, 'shell', 'echo', uploadFile.ver, '>', ANDROID_WORK_DIR + '/version'],
                          function /*on_close*/(ret, stdout, stderr) {
                            if (ret !== 0 || stdout || stderr) {
                              on_error(stderr ? beautifyStderr(stderr) : 'updateRemoteVer error');
                            } else {
                              devMgr[device].uploaded = true;
                              on_ok();
                            }
                          });
                    }
                  });
            }
          }
        });
  }
}

function chkerrCaptureParameter(q) {
  if (chkerrRequired('device', q.device) ||
      chkerrRequired('type', q.type, ['apng', 'webm', 'png']) ||
      q.type !== 'png' && chkerrRequired('fps', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS) ||
      chkerrOptional('rotate', (q.rotate = Number(q.rotate)), [0, 90, 270])) {
    return chkerr;
  }
  var n, match;
  if (q.scale) {
    if (!isNaN((n = Number(q.scale)))) { //can convert to a valid number
      if (chkerrRequired('number formatted scale', (q.scale = n), 0.1/*min*/, 1/*max*/)) {
        return chkerr;
      }
      if (q.scale === 1) {
        q.scale = '';
      }
    } else { //treat as string format 9999x9999
      if (!(match = (q.scale = String(q.scale)).match(/^(\d{0,4})x(\d{0,4})$/)) || !match[1] && !match[2]) {
        return setchkerr('string formatted scale parameter must be in pattern "9999x9999" or "9999x" or "x9999"');
      }
      q.scale_w = match[1] ? Number(match[1]) : 0;
      q.scale_h = match[2] ? Number(match[2]) : 0;
      if (!q.scale_w && !q.scale_h) {
        q.scale = '';
      }
    }
  } else {
    q.scale = '';
  }

  if (!q.rotate) {
    q.rotate = '';
  }

  return '';
}

function stringifyCaptureParameter(q, format /*undefined, 'filename', 'querystring'*/) {
  if (format === 'querystring') {
    var kvAry = [];
    ['device', (conf.adminWeb.adminKey ? 'accessKey' : ''), 'type', 'fps', 'scale', 'rotate'].forEach(function (name) {
      if (name) {
        kvAry.push(name + '=' + querystring.escape(q[name] || '')); //0, NaN are replaced by empty string
      }
    });
    return kvAry.join('&');
  } else {
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
}

/**
 * Capture screen, send result to output stream 'res'.
 * Please call chkerrCaptureParameter before this function.
 * @param outputStream result stream (e.g. HTTP response or file stream)
 * @param q option, Must have been checked by !chkerrCaptureParameter(q)
 *  {
 *    device:  device serial number
      type:    'apng' or 'webm' or 'png'
      fps:     [optional] rate for webm and apng. must be in range MIN_FPS~MAX_FPS
      scale:   [optional] 0.1 - 1 or string in format 9999x9999 or 9999x or x9999
      rotate:  [optional] 0, 90, 270
    }
 */
function capture(outputStream, q) {
  var res = outputStream;
  var dev = devMgr[q.device] || (devMgr[q.device] = {});
  var useExistingCapture = false;
  var provider, newProvider = {
    consumerMap: {}, lastConsumerId: 0, dev: dev, type: q.type, fps: q.fps, scale: q.scale, rotate: q.rotate,
    logHead: '[capture: ' + stringifyCaptureParameter(q, 'log') + ']'
  };
  if (q.type === 'png') {
    //for single png, it is light process, so let it coexistent with existing capture.
    provider = newProvider;
  } else if (dev.liveStreamer) { //there is an existing capture running or preparing
    if (dev.liveStreamer.type !== q.type) {
      __cleanup_all(dev.liveStreamer, 'another capture with different type is requested');
      provider = dev.liveStreamer = newProvider;
    } else if (dev.liveStreamer.fps < q.fps) {
      __cleanup_all(dev.liveStreamer, 'another capture with faster rate is requested');
      provider = dev.liveStreamer = newProvider;
    } else if (dev.liveStreamer.scale !== q.scale) {
      __cleanup_all(dev.liveStreamer, 'another capture with different scale is requested');
      provider = dev.liveStreamer = newProvider;
    } else if (dev.liveStreamer.rotate !== q.rotate) {
      __cleanup_all(dev.liveStreamer, 'another capture with different rotate degree is requested');
      provider = dev.liveStreamer = newProvider;
    } else if (dev.liveStreamer.type === 'webm') {
      //theoretically WebM video stream can be broadcast to multiple client if fps is same,
      //but currently can not be analysed correctly, so this feature is not supported yet.
      //Specially, if no any consumer started output yet, it is possible to share the capture.
      if (Object.keys(dev.liveStreamer.consumerMap).some(function (consumerId) {
        return dev.liveStreamer.consumerMap[consumerId].didWrite;
      })) {
        __cleanup_all(dev.liveStreamer, 'interrupted by another WebM capture request');
        provider = dev.liveStreamer = newProvider;
      } else {
        provider = dev.liveStreamer;
        useExistingCapture = true;
      }
    } else {
      //Animated PNG image stream can be broadcast to multiple client if fps is same
      provider = dev.liveStreamer;
      useExistingCapture = true;
    }
  } else { //there is no existing capture running or preparing
    provider = dev.liveStreamer = newProvider;
  }

  /*
   * add consumer
   */
  res.streamProvider = provider;
  res.consumerId = ++provider.lastConsumerId;
  provider.consumerMap[res.consumerId] = res;
  res.logHead = (res.logHead || '[]').slice(0, -1) + ' consumer#' + res.consumerId + ' of ' + provider.logHead.slice(1, -1) + ']';
  log(res.logHead + 'added');
  if (res.setHeader) {
    res.setHeader('Content-Type', q.type === 'webm' ? 'webm' : q.type === 'png' ? 'image/png' : MULTIPART_MIXED_REPLACE);
  }
  res.on('close', function () {
    __cleanup(res, 'output stream is closed by external'/*do not change this string*/);
  });

  if (useExistingCapture) {
    log(res.logHead + 'use existing capture process ' + (provider.pid ? provider.pid : '(still in preparing)'));
  } else {
    uploadFile(q.device,
        function /*on_ok*/() {
          if (Object.keys(provider.consumerMap).length === 0) {
            return; //abort
          }
          var FFMPEG_OUTPUT = '';
          if (conf.ffmpegStatistics !== true) {
            FFMPEG_OUTPUT += ' -nostats';
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
              FFMPEG_OUTPUT += ' -vf ' + filter.slice(1);
            }
          }
          if (q.type === 'webm') { //webm video
            FFMPEG_OUTPUT += ' -f webm -vcodec libvpx -rc_lookahead 0 -qmin 0 -qmax 20 -b:v 1000k';
          } else if (q.type === 'apng') { //animated png image
            FFMPEG_OUTPUT += ' -f image2 -vcodec png -update 1';
          } else {               //single png image
            FFMPEG_OUTPUT += ' -f image2 -vcodec png -vframes 1';
          }
          FFMPEG_OUTPUT += ' -'; //means output to stdout
          /*
           * ------------------------------------start new capture process ---------------------------------------------
           */
          var childProc = spawn(provider.logHead, conf.adb, ['-s', q.device, 'shell', 'cd', ANDROID_WORK_DIR, ';', 'sh', './capture.sh', q.fps || 0, q.fps || 1, FFMPEG_OUTPUT, (conf.remoteLogAppend ? '2>>' : '2>'), ANDROID_WORK_DIR + '/log']);
          provider.pid = childProc.pid;

          Object.keys(provider.consumerMap).forEach(function (consumerId) {
            var _res = provider.consumerMap[consumerId];
            _res.logHead = _res.logHead.replace(provider.logHead.slice(1, -1), childProc.logHead.slice(1, -1));
          });
          provider.logHead = childProc.logHead;

          childProc.stdout.on('data', function (buf) {
            __convertAdbNewLineSeqToLF(provider, buf).forEach(function (buf) {
              if (provider.type === 'apng') { //broadcast animated png image to multiple client
                playANPGBuffer(provider, buf, 0, buf.length);
              } else {
                Object.keys(provider.consumerMap).forEach(function (consumerId) {
                  write(provider.consumerMap[consumerId], buf);
                });
              }
            });
          });
          childProc.stderr.on('data', function (buf) {
            log(buf, {noNewLine: true, head: childProc.logHead});
            dev.uploaded = false;
          });
          childProc.on('close', function () {
            __cleanup_all(provider, 'capture process exited'/*do not change this string*/);
          });
        },
        function/*on_error*/(err) {
          __cleanup_all(provider, err);
        }
    ); //end of uploadFile
  }
}

function startRecording(q/*same as capture*/, on_prepared) {
  uploadFile(q.device,
      function /*on_ok*/() {
        var filename = stringifyCaptureParameter(q, 'filename');

        var wfile = fs.createWriteStream(conf.outputDir + '/' + filename);
        wfile.logHead = '[record: ' + filename + ']';
        wfile.filename = filename;

        wfile.on('open', function () {
          log(wfile.logHead + 'open file for write OK');
          capture(wfile, q); //capture to file
          if (on_prepared) {
            on_prepared('', wfile);
            on_prepared = null;
          }
        });
        wfile.on('close', function () {
          log(wfile.logHead + 'file closed');
          on_prepared = null;
        });
        wfile.on('error', function (err) {
          log(wfile.logHead + beautifyErrMsg(err));
          if (on_prepared) {
            on_prepared('file operation error');
            on_prepared = null;
          }
        });
        //do not worry, on close has been handled by capture()
      },
      function/*on_error*/(err) {
        if (on_prepared) {
          on_prepared(err);
          on_prepared = null;
        }
      }
  );
}

function stopRecording(device) {
  var dev, provider, res;
  if ((dev = devMgr[device]) && (provider = dev.liveStreamer)) {
    Object.keys(provider.consumerMap).forEach(function (consumerId) {
      if ((res = provider.consumerMap[consumerId]).filename) { //is file stream
        log(res.logHead + 'end file to stop recording');
        end(res); //cause end, close event
      }
    });
  }
}

function getRecordingFileName(device, type/*optional*/) {
  var dev, provider, filename = '';
  if ((dev = devMgr[device]) && (provider = dev.liveStreamer) && (!type || provider.type === type)) {
    Object.keys(provider.consumerMap).some(function (consumerId) {
      return (filename = provider.consumerMap[consumerId].filename) ? true : false;
    });
  }
  return filename;
}

function chkerrRecordedFileParameter(q, forDownload) {
  if (chkerrRequired('device', q.device) ||
      chkerrRequired('type', q.type, ['apng', 'webm']) ||
      !forDownload && q.type === 'apng' && chkerrOptional('fps', (q.fps = Number(q.fps)), MIN_FPS, MAX_FPS)) {
    return chkerr;
  }
  return '';
}

function stringifyRecordedFileParameter(q, format/*'querystring'*/) {
  if (format === 'querystring') {
    var kvAry = [];
    ['device', (conf.adminWeb.adminKey ? 'accessKey' : ''), 'type', 'fileIndex', (q.type === 'apng' ? 'fps' : '')].forEach(function (name) {
      if (name) {
        kvAry.push(name + '=' + querystring.escape(q[name] || '')); //0, NaN are replaced by empty string
      }
    });
    return kvAry.join('&');
  }
  return JSON.stringify(q);
}

/**
 * Play or download recorded file
 * must have been checked by !chkerrRecordedFileParameter(q)
 * @param httpOutputStream
 * @param q option. must have been checked by !chkerrRecordedFileParameter(q)
 *  {
 *    device:  device serial number
      type:    'apng' or 'webm'
      fileIndex: [optional] number or timestamp like 20140110_153928_704_000.
                Bigger number means older file. E.g. 1 means 1 generation older file.
      fps:     [optional] rate for apng only. must be in range MIN_FPS~MAX_FPS
    }
 * @param forDownload  true/false
 */
function playRecordedFile(httpOutputStream, q, forDownload/*optional*/) {
  findRecordedFiles(q.device, q.type, function /*on_complete*/(err, filenameAry) {
    var res = httpOutputStream, filename;
    if (!filenameAry || !(filename = filenameAry[q.fileIndex || 0])) {
      return end(res, err ? 'file operation error' : 'file not found');
    }
    res.logHead = (res.logHead || '[]').slice(0, -1) + ' ' + (forDownload ? 'download' : 'play') + ': ' + filename + ']';

    var rfile = fs.createReadStream(conf.outputDir + '/' + filename);

    rfile.on('open', function (fd) {
      log(res.logHead + 'open file for read OK');
      fs.fstat(fd, function/*on_complete*/(err, stats) {
        if (err) {
          log(res.logHead + 'fstat ' + err);
          return end(res, 'file operation error'); //will cause res.close event and cause call rfile.close
        }
        res.setHeader('Content-Type', (!forDownload && q.type === 'apng') ? MULTIPART_MIXED_REPLACE : 'video/' + q.type);
        if (forDownload) {
          res.setHeader('Content-Disposition', 'attachment;filename=asc~' + filename + '.' + q.type);
          res.setHeader('Content-Length', stats.size);
        } else {
          if (q.type === 'apng') {
            if (!q.fps) {
              q.fps = Number(filename.slice(querystring.escape(q.device).length + '~apng~f'.length).match(/^[0-9.]+/));
            }
          }
        }
        rfile.streamerId = registerStaticStreamer(q.device, q.type);
        rfile.restSize = stats.size;

        rfile.on('data', function (buf) {
          if (buf.length > rfile.restSize) { //do not play growing content
            buf = buf.slice(0, rfile.restSize);
          }
          rfile.restSize -= buf.length;

          if (q.type === 'apng') { //play apng specially, translate it to multipart output
            if (!rfile.consumerMap) {
              rfile.consumerMap = {undefined: res};
              rfile.startTimeMs = Date.now();
              rfile.frameIndex = 0;
            }
            playANPGBuffer(rfile/*as provider*/, buf, 0, buf.length, on_complete1Png);
          }
          else { //for normal video or download, just write content
            write(res, buf);
          }

          function on_complete1Png(pos/*next png start position*/) {
            if (conf.logAPNGProgress) {
              log((forDownload ? '[download: ' : '[play: ') + rfile.filename + ']frame ' + rfile.frameIndex + ' completed' + ((rfile.restSize === 0 && pos >= buf.length) ? '(last)' : ''));
            }
            if (pos < buf.length || rfile.restSize > 0) { //if have rest data
              //write next content-type early to force Chrome draw previous image immediately.
              //For last image, do not write next content-type head because it cause last image view invalidated.
              write(res, '\n--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/png\n\n');
              rfile.frameIndex++;
              rfile.pause();
              rfile.apngTimer = setTimeout(function /*__resume*/() {
                rfile.resume();
                playANPGBuffer(rfile/*as provider*/, buf, pos, buf.length, on_complete1Png);
              }, (rfile.startTimeMs + rfile.frameIndex * 1000 / q.fps) - Date.now());
            }
          }
        });

        rfile.on('end', function () {
          log(res.logHead + 'file end');
          end(res);
        });
        return null; //just for avoiding compiler warning
      });
    });

    rfile.on('close', function () {
      log(res.logHead + 'file closed');
      clearTimeout(rfile.apngTimer);
      unregisterStaticStreamer(q.device, rfile.streamerId);
    });

    rfile.on('error', function (err) {
      log(res.logHead + beautifyErrMsg(err));
      end(res, err.code === 'ENOENT' ? 'file not found' : 'file operation error');
    });

    //stop if http connection is closed by peer
    res.on('close', function () {
      rfile.close();
    });
    return null; //just for avoiding compiler warning
  });
}

function deleteRecordedFiles(device) {
  findRecordedFiles(device, null/*any type*/, function /*on_complete*/(err, filenameAry) {
    if (filenameAry) {
      filenameAry.forEach(function (filename) {
        fs.unlink(conf.outputDir + '/' + filename);
      });
    }
  });
}

function findRecordedFiles(device, type/*optional*/, on_complete) {
  fs.readdir(conf.outputDir, function (err, filenameAry) {
    if (err) {
      log('readdir ' + err);
      return on_complete(err);
    }
    var recordingFileName = getRecordingFileName(device, type);
    var devPrefix = querystring.escape(device) + '~';

    filenameAry = filenameAry.filter(function (filename) {
      return filename.slice(0, devPrefix.length) === devPrefix &&
          (!type || filename.slice(devPrefix.length).slice(0, 4) === type) &&
          filename !== recordingFileName;
    });

    //sort by time (newer first)
    filenameAry.sort(function (a, b) {
      a = a.slice(-nowStr.LEN);
      b = b.slice(-nowStr.LEN);
      return (a < b) ? 1 : (a > b) ? -1 : 0;
    });

    //make it searchable by timestamp
    filenameAry.forEach(function (filename) {
      filenameAry[filename.slice(-nowStr.LEN)] = filename;
    });

    return on_complete('', filenameAry);
  });
}

function getLiveStreamConsumerCount(device, type) {
  var dev, provider;
  if ((dev = devMgr[device]) && (provider = dev.liveStreamer) && provider.type === type) {
    return Object.keys(provider.consumerMap).reduce(function (previousSum, consumerId) {
      return provider.consumerMap[consumerId].filename ? previousSum : previousSum + 1;
    }, 0 /*initial previousSum*/);
  }
  return 0;
}

function registerStaticStreamer(device, type) {
  var dev = devMgr[device] || (devMgr = devMgr[device]);
  if (!dev.staticStreamerMap) {
    dev.staticStreamerMap = {};
    dev.lastStaticStreamerId = 0;
  }
  dev.staticStreamerMap[++(dev.lastStaticStreamerId)] = {type: type};
  return dev.lastStaticStreamerId;
}

function unregisterStaticStreamer(device, streamerId) {
  if (devMgr[device] && devMgr[device].staticStreamerMap) {
    delete devMgr[device].staticStreamerMap[streamerId];
  }
}

function getStaticStreamerCount(device, type) {
  if (devMgr[device] && devMgr[device].staticStreamerMap) {
    return Object.keys(devMgr[device].staticStreamerMap).reduce(function (previousSum, streamerId) {
      return (devMgr[device].staticStreamerMap[streamerId].type === type) ? (previousSum + 1) : previousSum;
    }, 0 /*initial previousSum*/);
  }
  return 0;
}

function __cleanup_all(provider, reason) {
  Object.keys(provider.consumerMap).forEach(function (consumerId) {
    __cleanup(provider.consumerMap[consumerId], reason);
  });
}

function __cleanup(res, reason) {
  //prevent endless loop by error event of the output stream
  if (res.didCleanup) {
    return;
  }
  res.didCleanup = true;

  log(res.logHead + 'clean_up' + (reason ? (' due to ' + reason) : ''));

  var provider = res.streamProvider;
  if (res.childConsumerId && provider.consumerMap[res.childConsumerId]) {
    __cleanup(provider.consumerMap[res.childConsumerId], 'parent consumer is closed');
  }

  if (reason !== 'output stream is closed by external') {
    end(res, reason);
  }

  //unsubscribe
  delete provider.consumerMap[res.consumerId];

  //if no consumer subscribe the output of screen capture process, then kill it
  if (Object.keys(provider.consumerMap).length === 0) {
    if (provider === provider.dev.liveStreamer) {
      provider.dev.liveStreamer = null;
    }
    if (provider.pid && reason !== 'capture process exited') {
      log(provider.logHead + 'kill due to all consumers are closed');
      try {
        process.kill(provider.pid, 'SIGKILL');
      } catch (e) {
      }
    }
  }
}

/*
 * write animated png stream to all consumers
 */
function playANPGBuffer(provider, buf, pos, endPos, on_complete1Png /*optional*/) {
  if (pos >= endPos) {
    return;
  }
  if (!provider.pngCacheLength) {
    //mark each consumer's start flag
    Object.keys(provider.consumerMap).forEach(__startPNG);

    provider.pngCacheLength = 0;
    if (!provider.pngCache) {
      provider.pngCache = new Buffer(APNG_CACHE_LEN);
    }
  }

  buf.copy(provider.pngCache, provider.pngCacheLength, pos, Math.min(endPos, pos + APNG_CACHE_LEN - provider.pngCacheLength));

  for (; pos < endPos; pos++) {
    provider.pngCacheLength++;
    /*
     * find tail
     */
    if (__isPngTail(provider.pngCache, provider.pngCacheLength - PNG_TAIL_LEN)) {
      //ok, png complete, write last part
      Object.keys(provider.consumerMap).forEach(__writeCache);

      //reset parser
      provider.pngCacheLength = 0;
      pos++;

      if (on_complete1Png) {
        on_complete1Png(pos);
      } else {
        Object.keys(provider.consumerMap).forEach(__complete1Png);
        playANPGBuffer(provider, buf, pos, endPos);
      }

      break;
    }
    /*
     * find body
     */
    else if (provider.pngCacheLength === APNG_CACHE_LEN) {
      //move some provider.pngCache data to output stream if big enough
      provider.pngCacheLength = APNG_CACHE_LEN - (PNG_TAIL_LEN - 1);
      Object.keys(provider.consumerMap).forEach(__writeCache);
      //copy last PNG_TAIL_LEN-1 byte to head
      provider.pngCache.copy(provider.pngCache, 0, APNG_CACHE_LEN - (PNG_TAIL_LEN - 1));
      provider.pngCacheLength = PNG_TAIL_LEN - 1;
    }
  }

  function __writeCache(consumerId) {
    var res = provider.consumerMap[consumerId];
    if (res.isAPNGStarted) {
      write(res, provider.pngCache.slice(0, provider.pngCacheLength));

      if (conf.logAPNGProgress) {
        if (res.pngIndex === undefined) {
          res.pngIndex = 0;
        }
        var filename = (res.filename ? res.filename + '_write' : provider.filename ? provider.filename + '_read' : 'http_write') + '_png_' + res.pngIndex + '.png';
        log(filename + ' length ' + provider.pngCacheLength);
        fs.createWriteStream(conf.outputDir + '/' + filename).end(provider.pngCache.slice(0, provider.pngCacheLength));
        res.pngIndex++;
      }
    }
  }

  function __isPngTail(buf, i/*position*/) {
    return (buf[i++] === 0x49 && buf[i++] === 0x45 && buf[i++] === 0x4E && buf[i++] === 0x44 && buf[i++] === 0xAE && buf[i++] === 0x42 && buf[i++] === 0x60 && buf[i] === 0x82);
  }

  function __startPNG(consumerId) {
    var res = provider.consumerMap[consumerId];
    if (res.setHeader) { //animated png
      if (!res.isAPNGStarted) {
        write(res, '--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/png\n\n');
      }
    }
    res.isAPNGStarted = true;
  }

  function __complete1Png(consumerId) {
    var res = provider.consumerMap[consumerId];
    if (res.isAPNGStarted && res.setHeader) {
      //write next content-type early to force Chrome draw previous image immediately.
      write(res, '\n--' + MULTIPART_BOUNDARY + '\n' + 'Content-Type:image/png\n\n');
    }
  }
} //end of playANPGBuffer()

/*
 * convert CRLF or CRCRLF to LF, return array of converted buf. Currently, this function only have effect on Windows OS
 */
function __convertAdbNewLineSeqToLF(provider, buf) {
  if (!provider.dev.CrCount) { //lucky! no CR prepended, so need not convert.
    return [buf];
  }
  var bufAry = [], startPos = 0, crCount = 0;
  /*
   * Resolve orphan [CR,CR] or [CR] which are produced by previous call of this function.
   * If it is followed by [LF] or [CR,LF], then they together are treated as a [LF],
   * Otherwise, the orphan seq will be output normally.
   */
  if (provider.orphanCrCount) {
    var restCrCount = provider.dev.CrCount - provider.orphanCrCount;
    // if adbNewLineSeq is found then skip rest CR, start from LF. Otherwise push orphan CR into result
    if (!restCrCount && buf[0] === LF || restCrCount && buf[0] === CR && buf.length > 1 && buf[1] === LF) {
      startPos = restCrCount;
    } else {
      bufAry.push(provider.orphanCrCount === 2 ? BUF_CR2 : BUF_CR);
    }
    provider.orphanCrCount = 0;
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
        provider.orphanCrCount = Math.min(crCount, provider.dev.CrCount);
        //commit data in range from last start position to current position-orphanCrCount
        if (startPos < buf.length - provider.orphanCrCount) {
          bufAry.push(buf.slice(startPos, buf.length - provider.orphanCrCount));
        }
        return bufAry;
      }
    }
    else {
      /*
       * if found 2 or 2 CR followed by LF, then CR will be discarded.
       * and data before CR will be pushed to result.
       */
      if (crCount >= provider.dev.CrCount && buf[i] === LF) {
        //commit data in range from last start position to current position-provider.dev.CrCount
        bufAry.push(buf.slice(startPos, i - provider.dev.CrCount));
        startPos = i;
      }

      crCount = 0;
    }
  }

  bufAry.push(buf.slice(startPos));
  return bufAry;
}//end of __convertAdbNewLineSeqToLF()

function chkerrPublicAccess(q) {
  if (conf.adminWeb.adminKey) { //if secure mode is on
    if (chkerrRequired('device', q.device) || chkerrRequired('accessKey', q.accessKey)) {
      return chkerr;
    }
    if (!devMgr[q.device] || devMgr[q.device].accessKey !== q.accessKey) {
      return setchkerr('access denied');
    }
  }
  return '';
}

function chkerrAdminAccess(q) {
  if (conf.adminWeb.adminKey) { //if secure mode is on
    if (q.adminKey !== conf.adminWeb.adminKey) {
      return setchkerr('access denied');
    }
  }
  return '';
}

function setDefaultHttpHeader(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private, proxy-revalidate, s-maxage=0'); // HTTP 1.1.
  res.setHeader('Pragma', 'no-cache'); // HTTP 1.0.
  res.setHeader('Expires', 0); // Proxies.
  res.setHeader('Vary', '*'); // Proxies.
  res.setHeader('Content-Type', 'text/plain');
  if (conf.supportXmlHttpRequest) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

function startStreamWeb() {
  var httpServer, httpSeq = 0, _isAnyIp = isAnyIp(conf.ip), smark = (conf.ssl.on ? 's' : '');
  if (conf.ssl.on) {
    log('load SSL server certificate and private key from PKCS12 file: ' + conf.ssl.certificateFilePath);
    var options = {pfx: fs.readFileSync(conf.ssl.certificateFilePath)};
    httpServer = require('https').createServer(options, handler);
  } else {
    httpServer = require('http').createServer(handler);
  }
  httpServer.logHead = '[StreamWebSrv]';
  httpServer.on('error', function (err) {
    log(httpServer.logHead + beautifyErrMsg(err), {stderr: true});
    process.exit(1);
  });
  log(httpServer.logHead + 'listen on ' + ( _isAnyIp ? '*' : conf.ip) + ':' + conf.port);
  httpServer.listen(conf.port, _isAnyIp ? undefined : conf.ip,
      function/*on_ok*/() {
        log(httpServer.logHead + 'OK');
      });

  function handler(req, res) {
    if (req.url === '/favicon.ico' || req.url.length > 1024 || req.method !== 'GET') {
      return res.end();
    }

    res.logHead = '[HTTP' + smark.toUpperCase() + '#' + (res.seq = ++httpSeq) + ']';
    log(res.logHead.slice(0, -1) + (conf.logHttpReqAddr ? ' ' + req.connection.remoteAddress + ':' + req.connection.remotePort : '') + ' ' + req.url + ' ]' + 'begin');

    // set stream error handler to prevent from crashing
    res.on('error', function (err) {
      log(res.logHead + err);
    });

    res.on('close', function () {
      log(res.logHead + 'closed by peer');
    });

    setDefaultHttpHeader(res);

    var parsedUrl = url.parse(req.url, true/*querystring*/), q = parsedUrl.query;
    if (!process) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
      q = {device: '', accessKey: '', type: '', fps: 0, scale: 0, rotate: 0, recordOption: '', fileIndex: 0};
    }
    if (chkerrPublicAccess(q)) {
      return end(res, chkerr);
    }

    switch (parsedUrl.pathname) {
      case '/capture': //---------------------------send capture result to browser & optionally save to file------------
        if (chkerrCaptureParameter(q) ||
            q.type === 'webm' && chkerrOptional('recordOption', q.recordOption, ['sync', 'async'])) {
          return end(res, chkerr);
        }
        if (q.type === 'webm' && q.recordOption) { //need record webm video at same time
          startRecording(q,
              function/*on_prepared*/(err, wfile) {
                if (err) {
                  end(res, err);
                } else {
                  if (q.recordOption === 'sync') {
                    res.childConsumerId = wfile.consumerId; //remember the file so that close it with res together
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
        if (chkerrRecordedFileParameter(q, false/*forPlay*/)) {
          return end(res, chkerr);
        }
        playRecordedFile(res, q, false/*forPlay*/);
        break;
      case '/downloadRecordedFile': //---------------------download recorded file---------------------------------------
        if (chkerrRecordedFileParameter(q, true/*forDownload*/)) {
          return end(res, chkerr);
        }
        playRecordedFile(res, q, true/*forDownload*/);
        break;
      case '/sampleHtmlToViewLiveCapture':  //------------------------show live capture (Just as a sample) -------------
        if (chkerrCaptureParameter(q)) {
          return end(res, chkerr);
        }
        uploadFile(q.device,
            function /*on_ok*/() {
              res.setHeader('Content-Type', 'text/html');
              end(res, htmlCache[q.type + '.html'] //this html will in turn open URL /capture?....
                  .replace(/#device\b/g, htmlEncode(q.device))
                  .replace(/@by\b/g, 'capture')
                  .replace(/@q\b/g, stringifyCaptureParameter(q, 'querystring'))
                  .replace(/#LiveOrStatic\b/g, 'Live Capture')
                  .replace(/#show_ifLiveView\b/g, '')
                  .replace(/#show_ifViewRecordedFile\b/g, 'none')
              );
            },
            function/*on_error*/(err) {
              end(res, err);
            }
        );
        break;
      case '/sampleHtmlToViewRecordedFile':  //----------------------show recorded file  (Just as a sample)-------------
        if (chkerrRecordedFileParameter(q, false/*forPlay*/)) {
          return end(res, chkerr);
        }
        findRecordedFiles(q.device, q.type, function/*on_complete*/(err, filenameAry) {
          if (!filenameAry || !filenameAry[q.fileIndex || 0]) {
            return end(res, err ? 'file operation error' : 'file not found');
          }
          res.setHeader('Content-Type', 'text/html');
          return end(res, htmlCache[q.type + '.html'] //this html will in turn open URL /playRecordedFile?....
              .replace(/#device\b/g, htmlEncode(q.device))
              .replace(/@by\b/g, 'playRecordedFile')
              .replace(/@q\b/g, stringifyRecordedFileParameter(q, 'querystring'))
              .replace(/#LiveOrStatic\b/g, 'Recorded Video')
              .replace(/#show_ifLiveView\b/g, 'none')
              .replace(/#show_ifViewRecordedFile\b/g, '')
          );
        });
        break;
      default:
        end(res, 'bad request');
    }
    return null; //just for avoiding compiler warning
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
    log(httpServer.logHead + beautifyErrMsg(err), {stderr: true});
    process.exit(1);
  });
  log(httpServer.logHead + 'listen on ' + ( _isAnyIp ? '*' : conf.adminWeb.ip) + ':' + conf.adminWeb.port);
  httpServer.listen(conf.adminWeb.port, _isAnyIp ? undefined : conf.adminWeb.ip,
      function/*on_ok*/() {
        log(httpServer.logHead + 'OK. You can start from http' + smark + '://' + (_isAnyIp ? '127.0.0.1' : conf.adminWeb.ip) + ':' + conf.adminWeb.port + (conf.adminWeb.adminKey ? '/?adminKey=' + conf.adminWeb.adminKey : ''), {stderr: true});
      });

  function handler(req, res) {
    if (req.url === '/favicon.ico' || req.url.length > 1024 || req.method !== 'GET') {
      return res.end();
    }

    res.isAdminWeb = true;
    res.logHead = '[AdminHTTP' + smark.toUpperCase() + '#' + (res.seq = ++httpSeq) + ']';
    log(res.logHead.slice(0, -1) + ' ' + req.url + ' ]' + 'begin');

    // set stream error handler to prevent from crashing
    res.on('error', function (err) {
      log(res.logHead + err);
    });

    res.on('close', function () {
      log(res.logHead + 'closed by peer');
    });

    setDefaultHttpHeader(res);

    var parsedUrl = url.parse(req.url, true/*querystring*/), q = parsedUrl.query;
    if (!process) { //impossible condition. Just prevent jsLint/jsHint warning of 'undefined member ... variable of ...'
      q = {adminKey: '', device: [], accessKey: '', type: '', fps: 0, scale: 0, rotate: 0, action: ''};
    }
    if (chkerrAdminAccess(q)) {
      return end(res, chkerr);
    }

    switch (parsedUrl.pathname) {
      case '/deviceControl':  //---------------------------------------access management-------------------------------
        switch (q.action) {
          case 'setAccessKey':
          case 'unsetAccessKey':
            if (!conf.adminWeb.adminKey) {
              return end(res, 'not in secure mode. Please set adminKey by configuration file and restart');
            }
            if (q.action === 'setAccessKey' && chkerrRequired('accessKey', q.accessKey) || chkerrRequired('device[]', q.device)) {
              return end(res, chkerr);
            }
            //set/unset access key for single or multiple devices
            (Array.isArray(q.device) ? uniqueNonEmptyArray(q.device) : [q.device]).forEach(function (device) {
              (devMgr[device] || (devMgr[device] = {})).accessKey = (q.action === 'setAccessKey' ? q.accessKey : '');
            });
            end(res, 'OK');
            break;
          case 'startRecording': //----------------------------------start recording file-------------------------------
            if (chkerrRequired('device[]', q.device)) {
              return end(res, chkerr);
            }
            var deviceAryOr1 = q.device;
            q.device = 'any'; //just for using chkerrCaptureParameter
            if (chkerrCaptureParameter(q)) {
              return end(res, chkerr);
            }
            var okAry = [], errAry = [];
            (Array.isArray(deviceAryOr1) ? uniqueNonEmptyArray(deviceAryOr1) : [deviceAryOr1]).forEach(
                function (device, i, devAry) {
                  var _q = {};
                  Object.keys(q).forEach(function (k) {
                    _q[k] = q[k];
                  });
                  _q.device = device;
                  startRecording(_q,
                      function/*on_prepared*/(err, wfile) {
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
          case 'stopRecording': //----------------------------------stop recording file---------------------------------
            if (chkerrRequired('device[]', q.device)) {
              return end(res, chkerr);
            }
            //stop recording on single or multiple devices
            (Array.isArray(q.device) ? uniqueNonEmptyArray(q.device) : [q.device]).forEach(stopRecording);
            end(res, 'OK');
            break;
          case 'deleteRecordedFiles'://-----------------------------delete recorded file---------------------------------
            if (chkerrRequired('device[]', q.device)) {
              return end(res, chkerr);
            }
            //delete recorded file on single or multiple devices
            (Array.isArray(q.device) ? uniqueNonEmptyArray(q.device) : [q.device]).forEach(deleteRecordedFiles);
            end(res, 'OK');
            break;
          default :
            return end(res, 'bad request');
        }
        break;
      case '/getInternalLog':  //--------------------------------get internal log file----------------------------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        spawn('[getInternalLog]', conf.adb, ['-s', q.device, 'shell', 'cat', ANDROID_WORK_DIR + '/log'],
            function  /*on_close*/(ret, stdout, stderr) {
              end(res, (stdout || beautifyStderr(stderr)).replace(/\0/g, '') || 'unknown error');
            }, {noLogStdout: true});
        break;
      case '/getDeviceCpuMemTop':  //--------------------------------get internal log file----------------------------------
        if (chkerrRequired('device', q.device)) {
          return end(res, chkerr);
        }
        uploadFile(q.device,
            function /*on_ok*/() {
              spawn('[getDeviceCpuMemTop]', conf.adb, ['-s', q.device, 'shell', 'chmod', '755', ANDROID_WORK_DIR + '/busybox', '&&', ANDROID_WORK_DIR + '/busybox', 'top', '-b', '-n' , '1'],
                  function  /*on_close*/(ret, stdout, stderr) {
                    end(res, (stdout || beautifyStderr(stderr)).replace(/\0/g, '') || 'unknown error');
                  }, {noLogStdout: true});
            },
            function/*on_error*/(err) {
              end(res, err);
            }
        );
        break;
      case '/': //---------------------------------------show menu of all devices---------------------------------------
        q.fps = q.fps || 4;
        q.type = 'webm';  //just for using chkerrCaptureParameter
        q.device = 'any'; //just for using chkerrCaptureParameter
        if (chkerrCaptureParameter(q)) {
          return end(res, chkerr);
        }
        getAllDevInfo(
            function /*on_complete*/(err, deviceList, infoList) {
              if (!err && (!deviceList || !deviceList.length)) {
                err = 'No any device connected';
              }
              else if (deviceList) {
                //save serial number and info to devMgr
                deviceList.forEach(function (device, i) {
                  (devMgr[device] || (devMgr[device] = {})).info = infoList[i];
                });
              }

              var html = htmlCache['menu.html'];

              //replace something concerned with adminKey
              if (!conf.adminWeb.adminKey) { //clear some unnecessary querystring
                html = html.replace(/&accessKey=@accessKey\b/g, '')
                    .replace(/&adminKey=@adminKey\b/g, '').replace(/\?adminKey=@adminKey&/g, '?').replace(/\?adminKey=@adminKey\b(?!&)/g, '');
              } else {
                html = html.replace(/@adminKey\b/g, querystring.escape(conf.adminWeb.adminKey));
              }
              html = html.replace(/#adminKey\b/g, htmlEncode(conf.adminWeb.adminKey || ''));

              //disable/check some buttons
              dynamicConfKeyList.forEach(function (k) {
                html = html.replace(new RegExp(k + '=' + (conf[k] ? 'true' : 'false') + '"><button', 'g'), '$& disabled');
              });
              html = html.replace(new RegExp('name="rotate" value="' + q.rotate + '"', 'g'), '$& checked');

              html = html
                  .replace(/#dev_enum_err\b/g, htmlEncode(err))
                  .replace(/[@#]MIN_FPS\b/g, String(MIN_FPS))
                  .replace(/[@#]MAX_FPS\b/g, String(MAX_FPS))
                  .replace(/[@#]fps\b/g, q.fps)
                  .replace(/[@#]scale\b/g, q.scale)
                  .replace(/[@#]rotate\b/g, q.rotate)
                  .replace(/@stream_web\b/g, 'http' + (conf.ssl.on ? 's' : '') + '://' + (isAnyIp(conf.ip) ? '127.0.0.1' : conf.ip) + ':' + conf.port)
                  .replace(/#show_ifStreamWebLocal\b/g, conf.ip === 'localhost' || conf.ip === '127.0.0.1' ? '' : 'none')
                  .replace(/#show_ifAdminWebLocal\b/g, conf.adminWeb.ip === 'localhost' || conf.adminWeb.ip === '127.0.0.1' ? '' : 'none')
                  .replace(/#hide_ifStreamWebSSL\b/g, conf.ssl.on ? 'none' : '')
                  .replace(/#hide_ifAdminWebSSL\b/g, conf.adminWeb.ssl.on ? 'none' : '')
                  .replace(/#hide_ifAdminKey\b/g, conf.adminWeb.adminKey ? 'none' : '')
                  .replace(/#show_ifAdminKey\b/g, conf.adminWeb.adminKey ? '' : 'none')
              ;

              //finally make html rows
              html = html.replace(/<!--repeatBegin-->[^\0]*<!--repeatEnd-->/, createMultipleHtmlRows);

              res.setHeader('Content-Type', 'text/html');
              end(res, html);

              function createMultipleHtmlRows(htmlRow) {
                //combine with existing other device serial number(maybe not connected) in devMgr
                if (deviceList && deviceList.length > 0) {
                  deviceList = deviceList.concat(Object.keys(devMgr).filter(function (device) {
                    return deviceList.indexOf(device) < 0;
                  }));
                } else {
                  deviceList = Object.keys(devMgr);
                }
                return deviceList.reduce(
                    function (joinedStr, device, i) {
                      var accessKey = devMgr[device] ? devMgr[device].accessKey : '';
                      return joinedStr + htmlRow //do some device concerned replace
                          .replace(/#devinfo\b/g, htmlEncode(infoList[i] || 'Unknown'))
                          .replace(/#devinfo_class\b/g, htmlEncode(infoList[i] ? '' : 'errorWithTip'))
                          .replace(/#device\b/g, htmlEncode(device))
                          .replace(/@device\b/g, querystring.escape(device))
                          .replace(/@accessKey\b/g, querystring.escape(accessKey || ''))
                          .replace(/#accessKey_disp\b/g, htmlEncode(accessKey || '<None> Please "Set Access Key" for this device'))
                          .replace(/#styleName_AccessKey_disp\b/g, accessKey ? 'infoWithTip' : 'errorWithTip')
                          .replace(/#isRecording_webm\b/g, getRecordingFileName(device, 'webm') ? 'YES' : 'NO')
                          .replace(/#isRecording_apng\b/g, getRecordingFileName(device, 'apng') ? 'YES' : 'NO')
                          .replace(/#streamingCount_webm\b/g, getLiveStreamConsumerCount(device, 'webm') + getStaticStreamerCount(device, 'webm'))
                          .replace(/#streamingCount_apng\b/g, getLiveStreamConsumerCount(device, 'apng') + getStaticStreamerCount(device, 'apng'))
                          ;
                    }, ''/*initial joinedStr*/);
              }
            });
        break;
      case '/jquery-2.0.3.js': //todo: delete
        res.setHeader('Content-Type', 'text/javascript');
        end(res, htmlCache['jquery-2.0.3.js']);
        break;
      case '/stopServer':  //------------------------------------stop server management---------------------------------
        end(res, 'OK');
        log(httpServer.logHead + 'stop on demand');
        setTimeout(function () {
          process.exit(0);
        }, 10);
        break;
      case '/restartAdb':  //------------------------------------restart ADB--------------------------------------------
        end(res, 'OK');
        log(httpServer.logHead + 'restart ADB');
        spawn('[stopAdb]', conf.adb, ['kill-server'],
            function  /*on_close*/(/*ret, stdout, stderr*/) {
              spawn('[startAdb]', conf.adb, ['start-server'],
                  function  /*on_close*/(/*ret, stdout, stderr*/) {
                  });
            });
        break;
      case '/reloadResource':  //-----------------------------reload resource file to cache-----------------------------
        loadResourceSync();
        end(res, 'OK');
        break;
      case '/var':  //------------------------------change some config var----------------------------------
        if (dynamicConfKeyList.some(function (k) {
          return chkerrOptional(k, q[k], ['true', 'false']) ? true : false;
        })) {
          return end(res, chkerr);
        }
        dynamicConfKeyList.forEach(function (k) {
          if (q[k]) {
            conf[k] = (q[k] === 'true');
          }
        });
        end(res, 'OK');
        break;
      default:
        end(res, 'bad request');
    }
    return null; //just for avoiding compiler warning
  }
}

function loadResourceSync() {
  uploadFile.ver = uploadFile.ver || fs.readdirSync(UPLOAD_LOCAL_DIR).reduce(function (joinedStr, filename) {
    return joinedStr + fs.statSync(UPLOAD_LOCAL_DIR + '/' + filename).mtime.valueOf().toString(36) + '_';
  }, ''/*initial joinedStr*/);

  fs.readdirSync('./html').forEach(function (filename) {
    htmlCache[filename] = fs.readFileSync('./html/' + filename).toString();
  });

  //scan recorded files to get device serial numbers ever used
  fs.readdirSync(conf.outputDir).forEach(function (filename) {
    var match = filename.match(/^([^~]+)~/);
    if (match) {
      var device = querystring.unescape(match[1]);
      if (!devMgr[device]) {
        devMgr[device] = {};
      }
    }
  });
}

checkAdb(
    function/*on_ok*/() {
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
//done: check device existence for sampleHtmlToViewLiveCapture request
//done: stress test live capture (animated PNG)
//done: stress test live capture (webm)
//done: test close http stream when downloading or playing
//done: do not show recording file, only show latest recorded file
//done: check device availability first in /sampleHtmlToViewRecordedFile or /sampleHtmlToViewLiveCapture
//done: show streaming counter in menu page
//done: resize and rotate locally by html css3
//done: add conf.maxRecordedFileSize limitation
//done: support replay specified recorded file by fileIndex querystring( in number format or string format like 20140110_153928_704_000)

//todo: test big file recording
//todo: apng stream split logic  (Firefox failed to play recorded file some times)
//todo: test: on Windows OS, IE
//todo: convert apng to mp4 so can control progress by viewer
//todo: safari: multipart/x-mixed-replace
//todo: kill orphan process
//todo: join two webm file
//todo: send webm video to browser and file at same time. Completely remove recordOption when sampleHtmlToViewLiveCapture
//todo: adapt fps change without interrupting viewer
//todo: use error image or video to show error
//todo: water mark
//todo: add audio
//todo: make touchable: forward motion event to android
//todo: remove dependence of adb
