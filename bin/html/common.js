function setTouchHandler(htmlImgElement, touchServerUrl) {
  setTimeout(function () {
    __prepareTouchServer(touchServerUrl, function/*on_ok*/() {
      htmlImgElement.touchServerUrl = touchServerUrl;
      if (!htmlImgElement.didInitEventHandler) {
        htmlImgElement.didInitEventHandler = true;
        __setTouchHandler(htmlImgElement);
      }
    }, 10/*retry times*/);
  }, 100);
}

function __prepareTouchServer(touchServerUrl, on_ok, retryCounter) {
  console.log('prepare touch server');
  $.ajax(touchServerUrl, {timeout: 10 * 1000})
      .done(function (result) {
        console.log('prepare touch server result: ' + result);
        if (result === 'OK') {
          on_ok();
        } else if (result === 'preparing' || result === 'device is not being live viewed') {
          if (retryCounter >= 2) {
            setTimeout(function () {
              __prepareTouchServer(touchServerUrl, on_ok, retryCounter - 1);
            }, 500);
          }
        }
      })
      .fail(function (jqXHR, textStatus) {
        console.log('prepare touch server error: ' + textStatus);
      });
}

function __setTouchHandler(htmlImgElement) {
  var $htmlImgElement = $(htmlImgElement);
  $htmlImgElement
      .on('mousedown', function (e) {
        saveOrSendMouseAction(e);
        $htmlImgElement.mousemove(function (e) {
          saveOrSendMouseAction(e);
        }).mouseout(function (e) {
              saveOrSendMouseAction(e);
              $htmlImgElement.unbind('mousemove').unbind('mouseout');
            });
      })
      .on('mouseup', function (e) {
        saveOrSendMouseAction(e);
        $htmlImgElement.unbind('mousemove').unbind('mouseout');
      })
      .on('dragstart', function () {
        return false; //disable drag
      })
  ;

  var evtAry = [];
  var isFirefox = (navigator.userAgent.match(/Firefox/i) !== null);

  function saveOrSendMouseAction(e) {
    if (e.offsetX === undefined) {
      e.offsetX = e.clientX - $htmlImgElement.offset().left;
    }
    if (e.offsetY === undefined) {
      e.offsetY = e.clientY - $htmlImgElement.offset().top;
    }
    var vw = $htmlImgElement.outerWidth();
    var vh = $htmlImgElement.outerHeight();
    if (isFirefox) {
      if ($htmlImgElement.css('transform').indexOf('matrix') < 0) {
        if (vw < vh) {
          e.xPer = Math.min(1, Math.max(0, e.offsetX / vw));
          e.yPer = Math.min(1, Math.max(0, e.offsetY / vh));
        } else {
          e.xPer = Math.min(1, Math.max(0, (vh - e.offsetY) / vh));
          e.yPer = Math.min(1, Math.max(0, e.offsetX / vw));
        }
      } else {
        if (vw < vh) {
          e.xPer = Math.min(1, Math.max(0, (vw - e.offsetY) / vw));
          e.yPer = Math.min(1, Math.max(0, e.offsetX / vh));
        } else {
          e.xPer = Math.min(1, Math.max(0, (vh - e.offsetX) / vh));
          e.yPer = Math.min(1, Math.max(0, (vw - e.offsetY) / vw));
        }
      }
    } else {
      if (vw < vh) {
        e.xPer = Math.min(1, Math.max(0, e.offsetX / vw));
        e.yPer = Math.min(1, Math.max(0, e.offsetY / vh));
      } else {
        e.xPer = Math.min(1, Math.max(0, (vh - e.offsetY) / vh));
        e.yPer = Math.min(1, Math.max(0, e.offsetX / vw));
      }
    }
    if (evtAry.length) {
      evtAry.push(e);
    } else {
      sendMouseAction(e);
    }
  }

  function sendMouseAction(e) {
    console.log('send touch event: ' + e.type + ' ' + e.xPer + ' ' + e.yPer);
    $.ajax(htmlImgElement.touchServerUrl + '&type=' + e.type.slice(5, 6)/*d:down, u:up: o:out, m:move*/ + '&x=' + e.xPer + '&y=' + e.yPer,
        {timeout: 2000})
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
        .fail(function (jqXHR, textStatus) {
          console.log('send touch event error: ' + textStatus);
          evtAry = [];
        })
  }
}

function rotateLocally(viewer, viewerContainer) {
  'use strict';
  var j, clsAry = viewer.className.split(/ +/);
  if ((j = clsAry.indexOf('rotate270')) >= 0) {
    clsAry[j] = '';
  } else {
    clsAry.push('rotate270');
  }
  var $viewerContainer = $(viewerContainer);
  var w = $viewerContainer.outerWidth();
  var h = $viewerContainer.outerHeight();
  $viewerContainer.width(h);
  $viewerContainer.height(w);
  viewer.style.display = 'none';
  viewer.className = clsAry.join(' ');
  viewer.style.display = '';
}

function scaleLocally(viewerContainer) {
  'use strict';
  var j, clsAry = viewerContainer.className.split(/ +/);
  if ((j = clsAry.indexOf('scale50')) >= 0) {
    clsAry[j] = 'scale25';
  } else if ((j = clsAry.indexOf('scale25')) >= 0) {
    clsAry[j] = '';
  } else {
    clsAry.push('scale50');
  }
  viewerContainer.style.display = 'none';
  viewerContainer.className = clsAry.join(' ');
  viewerContainer.style.display = '';
}
