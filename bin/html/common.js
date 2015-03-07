var AscUtil = {debug: false, showEventsOnly: false};

(function ($) {
  'use strict';
  AscUtil.setTouchHandler = function (liveImage, touchServerUrl, rootRotator) {
    var $liveImage = $(liveImage), $rootRotator = rootRotator ? $(rootRotator) : $liveImage;
    var evtAry = [], touchstart_delaySendTimer, touchstart_e;
    var isDesktopFirefoxStyle = /Firefox|Android/i.test(navigator.userAgent);
    var typeMap = {mousedown: 'd', mousemove: 'm', mouseup: 'u', mouseout: 'o', touchstart: 'd', touchend: 'u', touchmove: 'm', touchcancel: 'o', touchleave: 'o'};
    !typeMap && console.log({changedTouches: null, touches: null}); //just to avoid compiler warning

    $liveImage
        .unbind('mousedown touchstart dragstart mouseenter mouseout')
        .on('mouseenter.detect_input_focus', function () {
          AscUtil.url_sendKey = touchServerUrl.replace(/touch\?/, 'sendKey?');
          AscUtil.url_sendText = touchServerUrl.replace(/touch\?/, 'sendText?');
        })
        .on('mouseout.detect_input_focus', function () {
          AscUtil.url_sendKey = AscUtil.url_sendText = null;
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
    ;

    if (!AscUtil.textQueue) {
      AscUtil.keyQueue = [];
      AscUtil.textQueue = [];

      $(document.body).unbind('keydown.live_input keypress.live_input')
          .on('keydown.live_input', function (e) {
            if (!AscUtil.url_sendKey) return; //do nothing if mouse is not inside some live image
            var c = e.which === 0xd ? 66/*KEYCODE_ENTER*/ : e.which === 0x8 ? 67 /*KEYCODE_DEL*/ : e.which === 0x2e ? 112 /*KEYCODE_FORWARD_DEL*/ : 0;
            if (!c) return;
            AscUtil.keyQueue.push(c) && AscUtil.keyQueue.length === 1 && sendKey();
            e.preventDefault();

            function sendKey() {
              if (!AscUtil.keyQueue.length) return;
              $.ajax(AscUtil.url_sendKey + '&keyCode=' + AscUtil.keyQueue.shift(), {timeout: 3000})
                  .done(function () {
                    sendKey();
                  })
                  .fail(function () {
                    AscUtil.keyQueue = [];
                  });
            }
          })
          .on('keypress.live_input', function (e) {
            if (!AscUtil.url_sendText) return; //do nothing if mouse is not inside some live image
            if (e.metaKey || e.which < 0x20 || e.which > 0x7f) return;
            var c = e.which === 0x20 ? '%s' : String.fromCharCode(e.which);
            AscUtil.textQueue.push(c) && AscUtil.textQueue.length === 1 && sendText();
            e.preventDefault();

            function sendText() {
              if (!AscUtil.textQueue.length) return;
              var t = AscUtil.textQueue.join('');
              AscUtil.textQueue = [];
              $.ajax(AscUtil.url_sendText + '&text=' + encodeURIComponent(t), {timeout: 3000})
                  .done(function () {
                    sendText();
                  })
            }
          });
    }

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
          touchstart_delaySendTimer = setTimeout(function () {
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

    function sendMouseAction(e) {
      $.ajax(touchServerUrl + '&type=' + typeMap[e.type] + '&x=' + e.xPer.toFixed(5) + '&y=' + e.yPer.toFixed(5), {timeout: 3000})
          .done(function () {
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
          })
          .fail(function () {
            evtAry = [];
          });
    }
  };

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
    var err_extension_not_installed = 'Please confirm about "Sumatium ADB Bridge" Chrome Extension: \n\t* it has been installed to current Chrome Browser(from Chrome Store). \n\t*. it has been configured to allow current web page to connect to it.';
    var CHROME_EXTENSION_ID = 'bfipgicjldmmihdbneggbdmindfbmgfn';
    var devMap = {/*adbBridgeWebSocketUrl:*/};

    function getOrCreateVirtualAdbDevice(adbBridgeWebSocketUrl) {
      var url = getWebSocketURL(adbBridgeWebSocketUrl);
      return devMap[url] || (devMap[url] = {
            info: {
              conId: '', //i.e. "localhost:50300"
              connected: false,
              status: ''
            },
            url: url,
            tag: makeLogHead(url),
            callbackAry: [],
            callback1Ary: []
          });
    }

    AscUtil.connectVirtualAdbDevice = function (adbBridgeWebSocketUrl, callback, timeout) {
      var dev = getOrCreateVirtualAdbDevice(adbBridgeWebSocketUrl);
      if (dev.chromeExtensionIPC) {
        callback && callback(dev.info);
        return;
      }

      console.log(dev.tag + ' connect');
      callback && dev.callback1Ary.push(callback);

      if (chrome && chrome.runtime && typeof(chrome.runtime.connect) === 'function') {
        try {
          dev.chromeExtensionIPC = chrome.runtime.connect(CHROME_EXTENSION_ID, {name: dev.url/*applied to chromeExtensionIPC.name*/, test: 'test'});
          if (dev.chromeExtensionIPC) {

            dev.chromeExtensionIPC.onDisconnect.addListener(function () {
              dev.chromeExtensionIPC = null;
              dev.info = {conId: '', connected: false, status: 'Chrome Extension is disconnected'};
              notifyCallbacks(dev);
            });

            dev.chromeExtensionIPC.onMessage.addListener(function (info) {
              if (typeof(info) === 'object') {
                clearNoResponseTimeout2(dev);
                dev.info = info;
                notifyCallbacks(dev);
              } else {
                clearNoResponseTimeout1(dev);
                if (arguments.length === 0) {
                  dev.info.status = (chrome.runtime.lastError && chrome.runtime.lastError.message || '') + '\n' + err_extension_not_installed;
                  notifyCallbacks(dev);
                  disconnect(dev);
                }
              }
            });

            dev.timer_disconnect1 = setTimeout(function () {
              disconnect(dev);
            }, 1000);
            dev.timer_disconnect2 = setTimeout(function () {
              disconnect(dev);
            }, timeout || 5000);
          }
        } catch (err) {
          console.log(err);
        }
      }

      if (!dev.chromeExtensionIPC) {
        dev.info.status = isChrome ? err_extension_not_installed : 'you must use Chrome Browser 32+';
        notifyCallbacks(dev);
      }
    };

    AscUtil.disconnectVirtualAdbDevice = function (adbBridgeWebSocketUrl) {
      var dev = getOrCreateVirtualAdbDevice(adbBridgeWebSocketUrl);
      if (!dev.chromeExtensionIPC) {
        return;
      }
      disconnect(dev);
    };

    function disconnect(dev) {
      var connected = dev.info.connected;
      console.log(dev.tag + ' disconnect');
      clearNoResponseTimeout1(dev);
      clearNoResponseTimeout2(dev);
      try {
        dev.chromeExtensionIPC.disconnect();
        dev.chromeExtensionIPC = null;
      } catch (err) {
        console.log(err);
      }
      dev.info = {conId: '', connected: false, status: 'disconnected'};

      connected && notifyCallbacks(dev);
    }

    function clearNoResponseTimeout1(dev) {
      if (dev.timer_disconnect1) {
        clearTimeout(dev.timer_disconnect1);
        dev.timer_disconnect1 = null;
      }
    }

    function clearNoResponseTimeout2(dev) {
      if (dev.timer_disconnect2) {
        clearTimeout(dev.timer_disconnect2);
        dev.timer_disconnect2 = null;
      }
    }

    AscUtil.watchVirtualAdbDevice = function (adbBridgeWebSocketUrl, callback/*(info)*/) {
      var dev = getOrCreateVirtualAdbDevice(adbBridgeWebSocketUrl);
      console.log(dev.tag + ' add status callback');
      dev.callbackAry.push(callback);
      dev.callbackAry.forEach(function (callback) {
        callback(dev.info);
      });
    };

    function notifyCallbacks(dev) {
      console.log(dev.tag + ' ' + JSON.stringify(dev.info));
      dev.callbackAry.forEach(function (callback) {
        callback(dev.info);
      });
      if (dev.info.status !== 'hello') {
        dev.callback1Ary.forEach(function (callback) {
          callback(dev.info);
        });
        dev.callback1Ary = [];
      }
    }

    function makeLogHead(url) {
      var match = url.match(/\bdevice=([^&]+)/), id = match ? decodeURIComponent(match[1]) : url;
      return '[VirtAdbDev ' + id + ']';
    }

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
  })();

})($/*jQuery*/);