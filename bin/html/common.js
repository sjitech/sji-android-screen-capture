var AscUtil = {debug: false, showEventsOnly: false};
true === false && console.log({changedTouches: 0, touches: 0, setFloat32: 0}); //just to avoid compiler warning

(function ($) {
  'use strict';
  (function/*RDC(Remote Desktop Connection) namespace*/() {

    //following websocket,queue,url are shared by multiple live view, touch, keyboard control
    var rdcWebSocket, keyQueue, txtQueue, targetDevUrlForSendKey, targetDevUrlForSendText;
    var DEF_TIMEOUT = 3000;

    RdcWebSocket_init();

    AscUtil.setTouchHandler = function (liveImage, touchServerUrl, rootRotator) {
      var $liveImage = $(liveImage), $rootRotator = rootRotator ? $(rootRotator) : $liveImage;
      var evtAry = [], touchstart_delaySendTimer, touchstart_e;
      var isDesktopFirefoxStyle = /Firefox|Android/i.test(navigator.userAgent);
      var typeMap = {mousedown: 'd', mousemove: 'm', mouseup: 'u', mouseout: 'o', touchstart: 'd', touchend: 'u', touchmove: 'm', touchcancel: 'o', touchleave: 'o'};

      $liveImage
          .unbind('mousedown touchstart dragstart mouseenter mouseout')
          .on('mouseenter.detect_input_focus', function () {
            targetDevUrlForSendKey = touchServerUrl.replace(/touch\?/, 'sendKey?');
            targetDevUrlForSendText = touchServerUrl.replace(/touch\?/, 'sendText?');
          })
          .on('mouseout.detect_input_focus', function () {
            targetDevUrlForSendKey = targetDevUrlForSendText = null;
          })
          .on('mousedown', function (e) { //touch handler for desktop browser
            if (e.which === 3) return; //skip right button
            saveOrSendMouseAction(e);
            $liveImage
                .on('mousemove', function (e) {
                  saveOrSendMouseAction(e);
                })
                .on('mouseup mouseout.detect_click_or_move', function (e) {
                  saveOrSendMouseAction(e);
                  $liveImage.unbind('mousemove mouseup mouseout.detect_click_or_move');
                })
            ;
          })
          .on('touchstart', function (e) { //touch handler for mobile browser
            if (isMultiTouch(e.originalEvent)) {
              AscUtil.showEventsOnly && console.log(Date.now() + ' multi-touch down');
              $liveImage.unbind('touchmove touchend touchcancel touchleave');
              clearTimeout(touchstart_delaySendTimer);
              touchstart_delaySendTimer = touchstart_e = null;
              return; //skip multi-touch
            }
            saveOrSendMouseAction(e);
            $liveImage
                .on('touchmove', function (e) {
                  if (isMultiTouch(e.originalEvent)) {
                    AscUtil.showEventsOnly && console.log('multi-touch move');
                    $liveImage.unbind('touchmove touchend touchcancel touchleave'); //ignore multi-touch
                  } else {
                    e.preventDefault(); //prevent scrolling/resizing page only if not touched by multi-finger
                    saveOrSendMouseAction(e);
                  }
                })
                .on('touchend touchcancel touchleave', function (e) {
                  saveOrSendMouseAction(e);
                  $liveImage.unbind('touchmove touchend touchcancel touchleave');
                })
                .unbind('mousedown') //need not mousedown event anymore
                .on('contextmenu', function () {
                  return false;
                })
            ;
          })
          .on('dragstart', function () {
            return false; //e.preventDefault() has no effect
          })
      ; //end of $liveImage.bind(...)

      if (!txtQueue) {
        txtQueue = [];
        keyQueue = [];

        $(document.body).unbind('keydown.live_input keypress.live_input')
            .on('keydown.live_input', function (e) {
              if (!targetDevUrlForSendKey) return; //do nothing if mouse is not inside some live image
              var c = e.which === 0xd ? 66/*KEYCODE_ENTER*/ : e.which === 0x8 ? 67 /*KEYCODE_DEL*/ : e.which === 0x2e ? 112 /*KEYCODE_FORWARD_DEL*/ : 0;
              if (!c) return;
              keyQueue.push(c) && keyQueue.length === 1 && sendKey();
              e.preventDefault();

              function sendKey() {
                if (!keyQueue.length) return;

                if (rdcWebSocket) {
                  if (devHandle) {
                    send_by_websocket();
                  } else {
                    RdcWebSocket_open_device(targetDevUrlForSendKey, function (err, handle) {
                      if (err) {
                        send_by_ajax();
                      } else {
                        devHandle = handle;
                        send_by_websocket();
                      }
                    }, {timeout: DEF_TIMEOUT});
                  }
                } else {
                  send_by_ajax();
                }

                function send_by_websocket() {
                  rdcWebSocket.__send(devHandle.toString(16) + ':' + String.fromCharCode(c), function (err/*, data*/) {
                    !err ? sendKey() : on_ng();
                  }, {timeout: DEF_TIMEOUT});
                }

                function send_by_ajax() {
                  $.ajax(targetDevUrlForSendKey + '&keyCode=' + keyQueue.shift(), {timeout: DEF_TIMEOUT})
                      .done(sendKey).fail(on_ng);
                }

                function on_ng() {
                  keyQueue = [];
                }
              }
            })
            .on('keypress.live_input', function (e) {
              if (!targetDevUrlForSendText) return; //do nothing if mouse is not inside some live image
              if (e.metaKey || e.which < 0x20 || e.which > 0x7f) return;
              var c = e.which === 0x20 ? '%s' : String.fromCharCode(e.which);
              txtQueue.push(c) && txtQueue.length === 1 && sendText();
              e.preventDefault();

              function sendText() {
                if (!txtQueue.length) return;
                var t = txtQueue.join('');
                txtQueue = [];

                if (rdcWebSocket) {
                  if (devHandle) {
                    send_by_websocket();
                  } else {
                    RdcWebSocket_open_device(targetDevUrlForSendText, function (err, handle) {
                      if (err) {
                        send_by_ajax();
                      } else {
                        devHandle = handle;
                        send_by_websocket();
                      }
                    }, {timeout: DEF_TIMEOUT});
                  }
                } else {
                  send_by_ajax();
                }

                function send_by_websocket() {
                  rdcWebSocket.__send(devHandle.toString(16) + '<' + t, function (err/*, data*/) {
                    !err && sendText();
                  }, {timeout: DEF_TIMEOUT});
                }

                function send_by_ajax() {
                  $.ajax(targetDevUrlForSendText + '&text=' + encodeURIComponent(t), {timeout: DEF_TIMEOUT})
                      .done(sendText)
                }
              }
            });
      } //end of initialization for sendKey and sentText

      function isMultiTouch(_e) {
        return _e && (_e.changedTouches && _e.changedTouches.length > 1 || _e.touches && _e.touches.length > 1);
      }

      function saveOrSendMouseAction(e) {
        if (AscUtil.debug) {
          debugger;
        }
        if (e.offsetX === undefined) {
          if (e.pageX) {
            e.offsetX = e.pageX - $liveImage.offset().left;
          } else if (e.originalEvent && e.originalEvent.changedTouches && e.originalEvent.changedTouches.length && e.originalEvent.changedTouches[0].pageX) {
            e.offsetX = e.originalEvent.changedTouches[0].pageX - $liveImage.offset().left; //for mobile browser
          } else {
            return;
          }
        }
        if (e.offsetY === undefined) {
          if (e.pageY) {
            e.offsetY = e.pageY - $liveImage.offset().top;
          } else if (e.originalEvent && e.originalEvent.changedTouches && e.originalEvent.changedTouches.length && e.originalEvent.changedTouches[0].pageY) {
            e.offsetY = e.originalEvent.changedTouches[0].pageY - $liveImage.offset().top; //for mobile browser
          } else {
            return;
          }
        }
        var vw = $liveImage.width(), vh = $liveImage.height();

        if (isDesktopFirefoxStyle) {
          if ($rootRotator.css('transform').indexOf('matrix') < 0) { //not rotated (portrait)
            if (vw < vh) {
              e.xPer = Math.min(1, Math.max(0, e.offsetX / vw));
              e.yPer = Math.min(1, Math.max(0, e.offsetY / vh));
            } else { //normally not used. Only used when capture in landscape
              e.xPer = Math.min(1, Math.max(0, (vh - e.offsetY) / vh));
              e.yPer = Math.min(1, Math.max(0, e.offsetX / vw));
            }
          } else { //rotated (landscape)
            if (vw < vh) {
              e.xPer = Math.min(1, Math.max(0, (vw - e.offsetY) / vw));
              e.yPer = Math.min(1, Math.max(0, e.offsetX / vh));
            } else { //normally not used. Only used when capture in landscape
              e.xPer = Math.min(1, Math.max(0, (vh - e.offsetX) / vh));
              e.yPer = Math.min(1, Math.max(0, (vw - e.offsetY) / vw));
            }
          }
        } else { //desktop chrome style
          if (vw < vh) {
            e.xPer = Math.min(1, Math.max(0, e.offsetX / vw));
            e.yPer = Math.min(1, Math.max(0, e.offsetY / vh));
          } else { //normally not used. Only used when capture in landscape
            e.xPer = Math.min(1, Math.max(0, (vh - e.offsetY) / vh));
            e.yPer = Math.min(1, Math.max(0, e.offsetX / vw));
          }
        }

        if (AscUtil.showEventsOnly) {
          console.log(Date.now() + ' ' + e.type + ' ' + e.xPer.toFixed(5) + ' ' + e.yPer.toFixed(5));
        } else {
          if (e.type === 'touchstart' && !touchstart_delaySendTimer) {
            touchstart_e = e;
            touchstart_delaySendTimer = setTimeout(function () { //give me a chance to detect isMultiTouch
              evtAry.length ? evtAry.push(e) : sendMouseAction(e);
            }, 20);
          } else {
            if (touchstart_delaySendTimer) {
              clearTimeout(touchstart_delaySendTimer);
              touchstart_delaySendTimer = null;
              evtAry.length ? evtAry.push(touchstart_e) : sendMouseAction(touchstart_e);
              touchstart_e = null;
            }
            evtAry.length ? evtAry.push(e) : sendMouseAction(e);
          }
        }
      }

      var devHandle;

      function sendMouseAction(e) {
        if (rdcWebSocket) {
          if (devHandle) {
            send_by_websocket();
          } else {
            RdcWebSocket_open_device(touchServerUrl, function (err, handle) {
              if (err) {
                send_by_ajax();
              } else {
                devHandle = handle;
                send_by_websocket();
              }
            }, {timeout: DEF_TIMEOUT});
          }
        }
        else {
          send_by_ajax();
        }

        function send_by_websocket() {
          var buf = new ArrayBuffer(13);
          var bv = new DataView(buf);
          bv.setUint32(0, devHandle);
          bv.setFloat32(4, e.xPer);
          bv.setFloat32(8, e.yPer);
          bv.setUint8(12, typeMap[e.type].charCodeAt(0));

          rdcWebSocket.__send(buf, function (err/*, data*/) {
            !err ? on_ok() : on_ng();
          }, {timeout: DEF_TIMEOUT});
        }

        function send_by_ajax() {
          $.ajax(touchServerUrl + '&type=' + typeMap[e.type] + '&x=' + e.xPer.toFixed(5) + '&y=' + e.yPer.toFixed(5), {timeout: DEF_TIMEOUT})
              .done(on_ok).fail(on_ng);
        }

        function on_ok() {
          if ((e = evtAry.shift())) {
            if (e.type === 'mousemove') {
              //get latest mousemove
              var _e = e;
              do {
                if (_e.type === 'mousemove') {
                  e = _e;
                } else {
                  break;
                }
              }
              while ((_e = evtAry.shift()));
            }
            sendMouseAction(e);
          }
        }

        function on_ng() {
          evtAry = [];
        }
      } //end of sendMouseAction

    }; //end of AscUtil.setTouchHandler

    function RdcWebSocket_open_device(devUrl, callback/*(err, devHandle)*/, opt/*{timeout:}*/) {
      rdcWebSocket.__send(devUrl, function (err, str) {
        if (err) {
          callback(err);
          return;
        }
        var res = JSON.parse(str);
        if (res.err) {
          console.log('[RdcWebSocket] open_device error: ' + res.err);
          callback(res.err);
          return;
        }
        console.log('[RdcWebSocket] open_device OK. devHandle: ' + res.handle);
        callback('', res.handle);
      }, opt && opt.timeout || DEF_TIMEOUT);
    } //end of open_device

    function RdcWebSocket_init() {
      if (!WebSocket) return;
      var wsTag = '[RdcWebSocket]';
      var ws = new WebSocket(getWebSocketURL('rdc'));
      ws.binaryType = 'arraybuffer'; //only affect type of e.data of on('message')
      delete ws.URL; //because chrome keep warning on it
      var callbackMap = {}, clientSeq = 0, serverSeq = 0;

      ws.addEventListener('open', function () {
        if (!ws) return;
        console.log(wsTag + ' opened');
        rdcWebSocket = ws;
      });
      ws.addEventListener('close', function (e) {
        if (!rdcWebSocket) return;
        console.log(wsTag + ' closed.' + (e.code ? ' code: ' + e.code : '') + (e.reason ? ' reason: ' + e.reason : ''));
        rdcWebSocket = null;
        cleanup('RdcWebSocket is closed');
        if (e.code !== 403) {
          setTimeout(RdcWebSocket_init, 10000);
        }
      });
      ws.addEventListener('error', function () {
        if (!rdcWebSocket) return;
        console.log(wsTag + ' error');
        cleanup('RdcWebSocket error');
      });

      ws.addEventListener('message', function (e) {
        if (!rdcWebSocket) return;
        var seq = serverSeq === 0xffffffff ? (serverSeq = 1) : (++serverSeq);
        var callback = callbackMap[seq];
        if (callback) {
          delete callbackMap[seq];
          callback('', e.data);
        }
      });

      ws.__send = function (data, callback/*(err, data)*/, opt/*{timeout:}*/) {
        var seq = clientSeq === 0xffffffff ? (clientSeq = 1) : (++clientSeq);
        ws.send(data);
        callbackMap[seq] = function (err, data) {
          clearTimeout(timer);
          err && console.log(wsTag + ' notify: ' + err);
          callback(err, data);
        };
        var timer = setTimeout(function () {
          delete callbackMap[seq];
          callback('timeout');
        }, opt && opt.timeout || DEF_TIMEOUT);
      };

      ws.__cleanup = cleanup;

      function cleanup(reason) {
        if (cleanup.called) return;
        console.log(wsTag + ' cleanup. reason: ' + reason);
        cleanup.called = true;
        if (rdcWebSocket) {
          rdcWebSocket.close();
          rdcWebSocket = null;
        }
        Object.keys(callbackMap).forEach(function (k) {
          callbackMap[k](reason);
        });
      }
    } //end of RdcWebSocket_init

  })(); //end of RDC namespace

  AscUtil.rotateChildLocally = function (targetContainer) {
    var $c = $(targetContainer), $v = $c.children(0);
    if ($v.css('transform').indexOf('matrix') < 0) {
      targetContainer.oldCss = {
        width: targetContainer.style.width,
        height: targetContainer.style.height,
        overflow: ''
      };
      var w = $c.outerWidth(true), h = $c.outerHeight(true);
      if (w === 0 || h === 0) {
        w = $v.outerWidth(true);
        h = $v.outerHeight(true);
      }
      $c.css({width: h, height: w, 'text-align': 'left', 'vertical-align': 'top', overflow: 'hidden'});
      $v.css({'transform-origin': '0 0', transform: 'rotate(270deg) translate(-100%,0)'});
    } else {
      $v.css({'transform-origin': '', transform: ''});
      $c.css(targetContainer.oldCss);
    }
  };

  AscUtil.loopLoadImage = function (liveImage, liveImageUrl) {
    var $liveImage = $(liveImage), src = (liveImageUrl || $liveImage.prop('src')).replace(/&?type=[^&]*/, '') + '&type=jpg';
    $liveImage.prop('src', '').prop('src', src); //close comet connection and trigger log once
    clearInterval(liveImage.__liveImageTimer);
    liveImage.__liveImageTimer = setInterval(function () {
      $liveImage.prop('src', src + '&timestamp=' + Date.now());
    }, 1000 / 4);
  };


  (function /*Virtual ADB Device functions*/() {
    var isChrome = /chrome/i.test(navigator.userAgent);
    var err_chrome_app_not_installed = 'you have not installed Chrome app named "Sumatium Virtual Android Device for ADB"';
    var CHROME_APP_ID = 'egjnjhhnnnjgolnphfhmhcjoiembdfmo';
    var devMap = {/*adbBridgeWebSocketUrl:*/};

    AscUtil.createVirtualAdbDevice = function (adbBridgeWebSocketUrl, callback/*be called multiple times*/, option/*{timeout, port}*/) {
      var url = getWebSocketURL(adbBridgeWebSocketUrl);
      var dev = devMap[url] || (devMap[url] = {
            info: {
              conId: '', //i.e. "localhost:50300"
              connected: false,
              status: ''
            },
            url: url,
            tag: makeLogHead(url),
            callbackAry: []
          });

      callback && dev.callbackAry.push(callback);

      if (dev.chromeAppIPC) {
        callback && callback(dev.info);
        return;
      }

      AscUtil.debug && console.log(dev.tag + ' create');

      try {
        if (chrome && chrome.runtime && typeof(chrome.runtime.connect) === 'function') {
          dev.chromeAppIPC = chrome.runtime.connect(CHROME_APP_ID, {
            name: JSON.stringify({
              url: dev.url,
              port: option && option.port,
              debug: AscUtil.debug
            }) //will be applied to chromeAppIPC.name
          });
          if (dev.chromeAppIPC) {

            dev.chromeAppIPC.onDisconnect.addListener(function () {
              dev.chromeAppIPC = null;
              cleanup(dev, 'Chrome app is disconnected');
            });

            dev.chromeAppIPC.onMessage.addListener(function (info) {
              if (typeof(info) === 'object') {
                clearNoResponseTimeout2(dev);
                dev.info = info;
                notifyCallbacks(dev);
              } else { //i.e. "hello"
                clearNoResponseTimeout1(dev);
                if (arguments.length === 0) {
                  AscUtil.debug && console.log(dev.tag + ' Chrome app error: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message || ''));
                  cleanup(dev, 'Chrome app error, or ' + err_chrome_app_not_installed);
                }
              }
            });

            dev.timer_close1 = setTimeout(function () {
              cleanup(dev, 'no hello response');
            }, 1000);
            dev.timer_close2 = setTimeout(function () {
              cleanup(dev, 'timeout');
            }, option && option.timeout || 5000);
          }
        }
      } catch (err) {
        AscUtil.debug && console.log(dev.tag + err);
      }

      !dev.chromeAppIPC && cleanup(dev, isChrome ? err_chrome_app_not_installed : 'you are not using Chrome browser');
    }; //end of AscUtil.createVirtualAdbDevice

    AscUtil.closeVirtualAdbDevice = function (adbBridgeWebSocketUrl) {
      var dev = devMap[getWebSocketURL(adbBridgeWebSocketUrl)];
      dev && cleanup(dev, 'on demand');
    };

    AscUtil.closeAllVirtualAdbDevices = function () {
      Object.keys(devMap).forEach(function (k) {
        cleanup(devMap[k], 'on demand');
      });
    };

    function cleanup(dev, reason) {
      if (!devMap[dev.url]) return;
      AscUtil.debug && console.log(dev.tag + ' cleanup. reason: ' + reason);
      delete devMap[dev.url];
      clearNoResponseTimeout1(dev);
      clearNoResponseTimeout2(dev);
      if (dev.chromeAppIPC) {
        try {
          dev.chromeAppIPC.disconnect();
          dev.chromeAppIPC = null;
        } catch (err) {
          AscUtil.debug && console.log(dev.tag + err);
        }
      }
      dev.info = {conId: '', connected: false, status: reason};
      notifyCallbacks(dev);
      dev.callbackAry = [];
    }

    function clearNoResponseTimeout1(dev) {
      if (dev.timer_close1) {
        clearTimeout(dev.timer_close1);
        dev.timer_close1 = null;
      }
    }

    function clearNoResponseTimeout2(dev) {
      if (dev.timer_close2) {
        clearTimeout(dev.timer_close2);
        dev.timer_close2 = null;
      }
    }

    function notifyCallbacks(dev) {
      AscUtil.debug && console.log(dev.tag + ' ' + JSON.stringify(dev.info));
      dev.callbackAry.forEach(function (callback) {
        callback(dev.info);
      });
    }

    function makeLogHead(url) {
      var match = url.match(/\bdevice=([^&]+)/), id = match ? decodeURIComponent(match[1]) : url;
      return '[VirtAdbDev ' + id + ']';
    }
  })(); //end of Virtual ADB Device functions

  function getWebSocketURL(url) {
    if (url.slice(0, 5) === 'ws://') {
      //
    } else if (url.slice(0, 6) === 'wss://') {
      //
    } else {
      if (url.slice(0, 7) === 'http://') {
        url = 'ws://' + url.slice(7);
      }
      else if (url.slice(0, 8) === 'https://') {
        url = 'wss://' + url.slice(8);
      }
      else if (url[0] === '/') {
        if (document.URL.slice(0, 7) === 'http://') {
          url = 'ws://' + document.URL.slice(7).replace(/^([^/]+).*$/, '$1' + url);
        } else if (document.URL.slice(0, 8) === 'https://') {
          url = 'ws://' + document.URL.slice(8).replace(/^([^/]+).*$/, '$1' + url);
        }
      }
      else {
        if (document.URL.slice(0, 7) === 'http://') {
          url = 'ws://' + document.URL.slice(7).replace(/\/[^/]+$/, '/' + url);
        } else if (document.URL.slice(0, 8) === 'https://') {
          url = 'wss://' + document.URL.slice(8).replace(/\/[^/]+$/, '/' + url);
        }
      }
    }
    return url;
  }
})($/*jQuery*/);