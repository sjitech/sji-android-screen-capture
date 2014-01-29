function rotateLocally(el) {
  'use strict';
  var j, clsAry = el.className.split(/ +/);
  if ((j = clsAry.indexOf('rotate90')) >= 0) {
    clsAry[j] = 'rotate270';
  } else if ((j = clsAry.indexOf('rotate270')) >= 0) {
    clsAry[j] = '';
  } else {
    clsAry.push('rotate90');
  }
  el.className = clsAry.join(' ');
}

function scaleLocally(el) {
  'use strict';
  var j, clsAry = el.className.split(/ +/);
  if ((j = clsAry.indexOf('scale50')) >= 0) {
    clsAry[j] = 'scale25';
  } else if ((j = clsAry.indexOf('scale25')) >= 0) {
    clsAry[j] = '';
  } else {
    clsAry.push('scale50');
  }
  el.className = clsAry.join(' ');
}
