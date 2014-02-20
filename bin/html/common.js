var viewerContainer = document.getElementById('viewerContainer');
var viewer = document.getElementById('viewer');

function rotateLocally() {
  'use strict';
  var j, clsAry = viewer.className.split(/ +/);
  if ((j = clsAry.indexOf('rotate90')) >= 0) {
    clsAry[j] = 'rotate270';
  } else if ((j = clsAry.indexOf('rotate270')) >= 0) {
    clsAry[j] = '';
  } else {
    clsAry.push('rotate90');
  }
  viewer.style.display = 'none';
  viewer.className = clsAry.join(' ');
  viewer.style.display = '';
}

function scaleLocally() {
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
