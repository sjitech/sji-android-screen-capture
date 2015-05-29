var AscUtil = {debug: false, debugBreak: false, showEventsOnly: false, useWebSocket: !!WebSocket};

(function ($) {
  'use strict';
  (function/*RDC(Remote Desktop Connection) namespace*/() {

    //following websocket,queue,url are shared by multiple live view, touch, keyboard control
    var rdcWebSocket, focusedLiveImage;
    var isDesktopFirefoxStyle = /Firefox|Android/i.test(navigator.userAgent);
    var touchTypeMap = {mousedown: 'd', mousemove: 'm', mouseup: 'u', mouseout: 'o', touchstart: 'd', touchend: 'u', touchmove: 'm', touchcancel: 'o', touchleave: 'o'};
    var DEF_TIMEOUT = 3000, WEBSOCKET_CONNECT_TIMEOUT = 10 * 1000;

    AscUtil.setTouchHandler = function (liveImage/*htmlElement*/, urlForSendTouchEvent, rootRotator/*htmlElement, optional*/) {
      var $liveImage = $(liveImage), $rootRotator = rootRotator ? $(rootRotator) : $liveImage;
      var evtAry = [], touchstart_delaySendTimer, touchstart_e;
      liveImage.ctx_sendTouch = {url: urlForSendTouchEvent, devHandle: undefined};
      liveImage.ctx_sendKey = {url: urlForSendTouchEvent.replace(/touch\?/, 'sendKey?'), devHandle: undefined};
      liveImage.ctx_sendText = {url: urlForSendTouchEvent.replace(/touch\?/, 'sendText?'), devHandle: undefined};

      if (AscUtil.useWebSocket) {
        RdcWebSocket_init(urlForSendTouchEvent);
      }

      init_touch_handler();

      init_keyboard_handler();

      function init_touch_handler() {
        $liveImage
            .unbind('mousedown touchstart dragstart mouseenter mouseout')
            .on('mouseenter.detect_input_focus', function () {
              focusedLiveImage = liveImage;
            })
            .on('mouseout.detect_input_focus', function () {
              focusedLiveImage = null;
            })
            .on('mousedown', function (e) { //touch handler for desktop browser
              if (e.which === 3) return; //skip right button
              convertToTouchEventAndSend(e);
              $liveImage
                  .on('mousemove', function (e) {
                    convertToTouchEventAndSend(e);
                  })
                  .on('mouseup mouseout.detect_click_or_move', function (e) {
                    convertToTouchEventAndSend(e);
                    $liveImage.unbind('mousemove mouseup mouseout.detect_click_or_move');
                  })
              ;
            })
            .on('touchstart', function (e) { //touch handler for mobile browser
              if (isMultiTouch(e.originalEvent)) {
                AscUtil.showEventsOnly && console.log(Date.now() + ' multi-touch down');
                $liveImage.unbind('touchmove touchend touchcancel touchleave');
                clearTimeout(touchstart_delaySendTimer);
                touchstart_e = null;
                return; //skip multi-touch
              }
              convertToTouchEventAndSend(e);
              $liveImage
                  .on('touchmove', function (e) {
                    if (isMultiTouch(e.originalEvent)) {
                      AscUtil.showEventsOnly && console.log('multi-touch move');
                      $liveImage.unbind('touchmove touchend touchcancel touchleave'); //ignore multi-touch
                    } else {
                      e.preventDefault(); //prevent scrolling/resizing page only if not touched by multi-finger
                      convertToTouchEventAndSend(e);
                    }
                  })
                  .on('touchend touchcancel touchleave', function (e) {
                    convertToTouchEventAndSend(e);
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
      } //end of init_touch_handler;

      function isMultiTouch(_e) {
        return _e && (_e.changedTouches && _e.changedTouches.length > 1 || _e.touches && _e.touches.length > 1);
      }

      function convertToTouchEventAndSend(e) {
        if (AscUtil.debugBreak) {
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
          if (e.type === 'touchstart' && !touchstart_e) {
            touchstart_e = e;
            touchstart_delaySendTimer = setTimeout(function () { //give me a chance to detect isMultiTouch, if is then cancel event
              evtAry.push(e) === 1 && sendTouchEvent();
            }, 20);
          } else {
            if (touchstart_e) {
              clearTimeout(touchstart_delaySendTimer);
              evtAry.push(touchstart_e) === 1 && sendTouchEvent();
              touchstart_e = null;
            }
            evtAry.push(e) === 1 && sendTouchEvent();
          }
        }
      } //end of convertToTouchEventAndSend

      function sendTouchEvent() {
        if (!evtAry.length) return;
        var e = evtAry[0], touchType = touchTypeMap[e.type], ctx = liveImage.ctx_sendTouch;
        send_by_websocket_or_ajax(ctx, send_by_websocket, send_by_ajax);

        function send_by_websocket() {
          if (ctx.devHandle === undefined) return on_ng();
          var buf = new ArrayBuffer(13);
          var bv = new DataView(buf);
          bv.setUint32(0, ctx.devHandle);
          bv.setFloat32(4, e.xPer);
          bv.setFloat32(8, e.yPer);
          bv.setUint8(12, touchType.charCodeAt(0));
          return rdcWebSocket.__send(buf, function (err, res) {
            !err && res === '' ? on_ok() : on_ng();
          });
        }

        function send_by_ajax() {
          $.ajax(ctx.url + '&type=' + touchType + '&x=' + e.xPer.toFixed(5) + '&y=' + e.yPer.toFixed(5), {timeout: DEF_TIMEOUT}).always(function (data) {
            data === 'OK' ? on_ok() : on_ng();
          });
        }

        function on_ok() {
          evtAry.shift();
          //remove continuous 'move' events except latest one
          var i = 0, cnt = 0, _e;
          while ((_e = evtAry[i++]) && touchTypeMap[_e.type] === 'm' /*move*/) cnt++;
          cnt > 1 && evtAry.splice(0, cnt - 1);
          sendTouchEvent();
        }

        function on_ng() {
          evtAry.length = 0;
        }
      } //end of sendMouseAction

    }; //end of AscUtil.setTouchHandler

    var keyCodeMap = {0x1b: 'BACK', 0xd: 'ENTER', 0x8: 'DEL', 0x2e: 'FORWARD_DEL', 0x25: 'DPAD_LEFT', 0x27: 'DPAD_RIGHT', 0x26: 'DPAD_UP', 0x28: 'DPAD_DOWN', 0x24: 'MOVE_HOME', 0x23: 'MOVE_END'};

    function init_keyboard_handler() {
      if (init_keyboard_handler.called) return;
      init_keyboard_handler.called = true;
      var txtQueue = [], keyQueue = [];

      $(document.body).unbind('keydown.live_input paste.live_input')
          .on('keydown.live_input', function (e) {
            if (!focusedLiveImage) return;
            var c = keyCodeMap[e.which];
            if (c) {
              keyQueue.push(c) === 1 && sendKey();
              e.preventDefault();
            } else if (e.which >= 0x20 && e.which <= 0x7f && !e.metaKey && !e.ctrlKey && !e.altKey) {
              c = String.fromCharCode(e.which);
              if (!e.shiftKey) c = c.toLowerCase();
              txtQueue.push(c) === 1 && sendText();
              e.preventDefault();
            }
          })
          .on("paste.live_input", function (e) {
            if (!focusedLiveImage) return;
            var clp = (e.originalEvent || e).clipboardData, text;
            if (clp === undefined || clp === null) {
              text = window.clipboardData.getData('text') || '';
            } else {
              text = clp.getData('text/plain') || '';
            }
            if (text) {
              var i = 0, cnt = text.length, sendNow = !txtQueue.length;
              for (; i < cnt; i++) {
                txtQueue.push(text[i]);
              }
              sendNow && sendText();
            }
            e.preventDefault();
          });
      //end of event binding

      function sendKey() {
        if (!keyQueue.length) return;
        var c = keyQueue[0], ctx = focusedLiveImage.ctx_sendKey;
        send_by_websocket_or_ajax(ctx, send_by_websocket, send_by_ajax);

        function send_by_websocket() {
          if (ctx.devHandle === undefined) return on_ng();
          return rdcWebSocket.__send(ctx.devHandle + ':' + c, function (err, res) {
            !err && res === '' ? on_ok() : on_ng();
          });
        }

        function send_by_ajax() {
          $.ajax(ctx.url + '&keyCode=' + c, {timeout: DEF_TIMEOUT}).always(function (data) {
            data === 'OK' ? on_ok() : on_ng();
          });
        }

        function on_ok() {
          keyQueue.shift(); //remove first items
          sendKey();
        }

        function on_ng() {
          keyQueue.length = 0;
        }
      } //end of sendKey

      function sendText() {
        if (!txtQueue.length) return;
        var len, t, ctx = focusedLiveImage.ctx_sendText;
        send_by_websocket_or_ajax(ctx, send_by_websocket, send_by_ajax);

        function send_by_websocket() {
          if (ctx.devHandle === undefined) return on_ng();
          len = Math.min(txtQueue.length, 2000);
          t = txtQueue.slice(0, len).join(''); //only get first MAX N chars
          return rdcWebSocket.__send(ctx.devHandle + '<' + t, function (err, res) {
            !err && res === '' ? on_ok() : on_ng();
          });
        }

        function send_by_ajax() {
          len = Math.min(txtQueue.length, 2000);
          t = txtQueue.slice(0, len).join(''); //only get first MAX N chars
          $.ajax(ctx.url + '&text=' + encodeURIComponent(t), {timeout: DEF_TIMEOUT}).always(function (data) {
            data === 'OK' ? on_ok() : on_ng();
          });
        }

        function on_ok() {
          txtQueue.splice(0, len); //remove first "len" items
          sendText();
        }

        function on_ng() {
          txtQueue.length = 0;
        }
      } //end of sendText

    } //end of init_keyboard_handler

    function send_by_websocket_or_ajax(ctx, send_by_websocket, send_by_ajax) {
      if (rdcWebSocket) {
        send_if_websocket_inited();
      } else {
        send_by_ajax();
      }

      function send_if_websocket_inited() {
        if (ctx.devHandle === undefined) {
          RdcWebSocket_open_device(ctx.url, function (err, handle) {
            if (!err) {
              ctx.devHandle = handle; //maybe still undefined
              send_by_websocket();
            }
          });
        } else {
          send_by_websocket();
        }
      } //end of send_if_websocket_inited
    } //end of send_by_websocket_or_ajax

    function RdcWebSocket_open_device(devUrl, callback/*(err, devHandle)*/, opt/*{timeout}*/) {
      rdcWebSocket.__send(devUrl, function (err, res) {
        if (err) {
          return callback(err);
        }
        var devHandle = res && Number(res);
        if (typeof(devHandle) !== 'number' || isNaN(devHandle) || devHandle < 0) {
          AscUtil.debug && console.log('[RdcWebSocket] open_device error: ' + (res || 'no valid devHandle returned'));
          return callback('', undefined);
        }
        AscUtil.debug && console.log('[RdcWebSocket] open_device OK. devHandle: ' + devHandle);
        return callback('', devHandle);
      }, opt && opt.timeout || DEF_TIMEOUT);
    } //end of RdcWebSocket_open_device

    function RdcWebSocket_init(devUrl) {
      if (rdcWebSocket || rdcWebSocket === '')  return;
      rdcWebSocket = '';

      var wsTag = '[RdcWebSocket]';
      var ws = new WebSocket(getWebSocketURL(devUrl));
      ws.binaryType = 'arraybuffer'; //only affect type of e.data of on('message')
      delete ws.URL; //because chrome keep warning on it
      var callbackMap = {}, clientSeq = 0, serverSeq = 0, timer_connectionTimeout;

      ws.addEventListener('open', function () {
        AscUtil.debug && console.log(wsTag + ' OPENED');
        rdcWebSocket = ws;
        clearTimeout(timer_connectionTimeout);
      });
      ws.addEventListener('close', function (e) {
        cleanup('CLOSED', (e.code || '') + (e.reason ? ' ' + e.reason : ''));
      });
      ws.addEventListener('error', function () {
        cleanup('network error');
        setTimeout(function () {
          RdcWebSocket_init(devUrl);
        }, WEBSOCKET_CONNECT_TIMEOUT);
      });

      ws.addEventListener('message', function (e) {
        var seq = serverSeq === 0xffffffff ? (serverSeq = 1) : (++serverSeq);
        var callback = callbackMap[seq];
        if (callback) {
          delete callbackMap[seq];
          AscUtil.debug && typeof(e.data) === 'string' && e.data !== '' && console.log(wsTag + ' recv "' + e.data + '"');
          callback('', e.data);
        }
      });

      ws.__send = function (data, callback/*(err, data)*/, opt/*{timeout:}*/) {
        var seq = clientSeq === 0xffffffff ? (clientSeq = 1) : (++clientSeq);
        ws.send(data);
        callbackMap[seq] = function (err, data) {
          clearTimeout(timer);
          callback(err, data);
        };
        var timer = setTimeout(function () {
          delete callbackMap[seq];
          callback('timeout');
        }, opt && opt.timeout || DEF_TIMEOUT);
      };

      timer_connectionTimeout = setTimeout(function () {
        cleanup('timeout');
        RdcWebSocket_init(devUrl);
      }, WEBSOCKET_CONNECT_TIMEOUT);

      return ws;

      function cleanup(reason, detail) {
        if (cleanup.called) return;
        cleanup.called = true;
        AscUtil.debug && console.log(wsTag + ' CLEANUP. Reason: ' + reason + '.' + (detail ? ' ' + detail : ''));
        reason !== 'CLOSED' && ws.close();
        rdcWebSocket = null;
        clearTimeout(timer_connectionTimeout);
        for (var k in callbackMap) { //noinspection JSUnfilteredForInLoop
          callbackMap[k](reason);
        }
        callbackMap = {};
      }
    } //end of RdcWebSocket_init

  })(); //end of RDC namespace -----------------------------------------------

  AscUtil.rotateChildLocally = function (targetContainer, explicitOrient) {
    //noinspection JSValidateTypes
    var $c = $(targetContainer), $v = $c.children();

    if (explicitOrient) {
      set_orient(explicitOrient === 'landscape');
    } else {
      set_orient(!get_orient());
    }

    function set_orient(orient) {
      if (orient === get_orient())
        return;

      if (targetContainer.__orig_orient === orient) {
        $v.css({'transform-origin': '', transform: ''});
        $c.css(targetContainer.oldCss);
      }
      else {
        var w = $c.outerWidth(true), h = $c.outerHeight(true);
        if (w === 0 || h === 0) {
          w = $v.outerWidth(true);
          h = $v.outerHeight(true);
        }
        $c.css({width: h, height: w, 'text-align': 'left', 'vertical-align': 'top', overflow: 'hidden'});
        $v.css({'transform-origin': '0 0', transform: 'rotate(270deg) translate(-100%,0)'});
      }
      targetContainer.__orient = !targetContainer.__orient;
    }

    function get_orient() {
      if (targetContainer.__orient === undefined) {
        var w = $c.outerWidth(true), h = $c.outerHeight(true);
        if (w === 0 || h === 0) {
          w = $v.outerWidth(true);
          h = $v.outerHeight(true);
        }
        targetContainer.__orig_orient = targetContainer.__orient = (w > h);

        targetContainer.oldCss = {
          width: targetContainer.style.width,
          height: targetContainer.style.height,
          overflow: ''
        };
      }
      return targetContainer.__orient;
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
                clearTimeout(dev.timer_close2);
                dev.info = info;
                notifyCallbacks(dev);
              } else { //i.e. "hello"
                clearTimeout(dev.timer_close1);
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
      } catch (e) {
        AscUtil.debug && console.log(dev.tag + e);
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
      clearTimeout(dev.timer_close1);
      clearTimeout(dev.timer_close2);
      if (dev.chromeAppIPC) {
        try {
          dev.chromeAppIPC.disconnect();
          dev.chromeAppIPC = null;
        } catch (e) {
          AscUtil.debug && console.log(dev.tag + e);
        }
      }
      dev.info = {conId: '', connected: false, status: reason};
      notifyCallbacks(dev);
      dev.callbackAry.length = 0;
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
  })(); //end of Virtual ADB Device functions --------------------------------

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
})(jQuery);

//just to avoid compiler warning of some undefined properties/methods
true === false && console.log({debugBreak: 0, changedTouches: 0, touches: 0, setFloat32: 0, lastError: ''});
