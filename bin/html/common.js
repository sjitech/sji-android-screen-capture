var AscUtil = {showEventsOnly: false, debug: false};

(function () {
  'use strict';
  AscUtil.setTouchHandler = function (liveImage, touchServerUrl, rootRotator) {
    var $liveImage = $(liveImage), $rootRotator = rootRotator ? $(rootRotator) : $liveImage;
    var evtAry = [], touchstart_delaySendTimer, touchstart_e;
    var isDesktopFirefoxStyle = /Firefox|Android/i.test(navigator.userAgent);
    var typeMap = {mousedown: 'd', mousemove: 'm', mouseup: 'u', mouseout: 'o', touchstart: 'd', touchend: 'u', touchmove: 'm', touchcancel: 'o', touchleave: 'o'};
    !typeMap && console.log({changedTouches: null, touches: null}); //just to avoid compiler warning

    $liveImage
        .unbind('mousedown touchstart dragstart')
        .on('mousedown', function (e) { //touch handler for desktop browser
          if (e.which === 3) return; //skip right button
          saveOrSendMouseAction(e);
          $liveImage
              .on('mousemove', function (e) {
                saveOrSendMouseAction(e);
              })
              .on('mouseup mouseout', function (e) {
                saveOrSendMouseAction(e);
                $liveImage.unbind('mousemove mouseup mouseout');
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
    }, 1000 / src.match(/fps=([^&]+)/)[1]);
  }
})();