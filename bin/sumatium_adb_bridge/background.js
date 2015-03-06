'use strict';
var debug = false;
if (false === true) var chrome = console.log({runtime: {}, onConnectExternal: {}, onDisconnect: {}, onMessage: {}, resultCode: 0, tcp: {}, tcpServer: {}, getInfo: Function, onAccept: {}, onAcceptError: {}, clientSocketId: 0, onReceive: {}, onReceiveError: {}, getUint32: Function, setUint32: Function, setUint8: Function, setPaused: Function, listen: Function, sockets: {}, addListener: Function, localPort: 0, removeListener: Function, disconnect: Function, connect: Function, bytesSent: 0, socketId: 0, __end: 0});
var LITTLE_ENDIAN = true;

chrome.runtime.onConnectExternal.addListener(function (chromeExtensionIPC) {
  var url = chromeExtensionIPC.name, dev = {}, adbBridgeWebSocket;
  console.log("connected from external: " + url);
  chromeExtensionIPC.postMessage('hello');

  chromeExtensionIPC.onDisconnect.addListener(function () {
    console.log('disconnected from external: ' + url);
    chromeExtensionIPC = null;
  });

  connectToWebSocket(url, function (err, ws) {
    if (err) {
      return dev_close(err);
    }
    adbBridgeWebSocket = ws;
    adbBridgeWebSocket.addEventListener('close', function () {
      dev_close('WebSocket is closed, so close dev');
    });
    adbBridgeWebSocket.addEventListener('message', function (e) {
      console.log('ws got message: ' + e.data.byteLength + ' bytes');
      dev.connected && chrome.sockets.tcp.send(dev.connectionId, e.data, function (sendInfo) {
        if (sendInfo.resultCode)
          console.error('failed to forward WebSocket data to adbHost. ' + getChromeLastError() + '(' + sendInfo.resultCode + ')');
        else
          console.log('forward WebSocket data to adbHost OK. ' + sendInfo.bytesSent + ' bytes sent');
      });
    });

    console.log('tcpServer.create');
    return chrome.sockets.tcpServer.create({}, function (createInfo) {
      if (createInfo.socketId <= 0) {
        return dev_close('tcpServer.create failed. ' + getChromeLastError());
      }
      console.log('tcpServer created: ' + JSON.stringify(createInfo));
      dev.serverSocketId = createInfo.socketId;

      console.log('tcpServer.listen');
      return chrome.sockets.tcpServer.listen(createInfo.socketId, '127.0.0.1', 0 /*random port*/, 0 /*backlog:auto*/, function (resultCode) {
        if (resultCode) {
          return dev_close('failed to listen socket. ' + getChromeLastError() + '(' + resultCode + ')');
        }
        console.log('tcpServer.listen OK');
        console.log('tcpServer.getInfo');
        return chrome.sockets.tcpServer.getInfo(createInfo.socketId, function (socketInfo) {
          console.log('tcpServer.getInfo OK. port: ' + socketInfo.localPort);
          dev.port = socketInfo.localPort;

          dev.onAccept = function (acceptInfo) {
            if (acceptInfo.socketId !== createInfo.socketId) return;
            dev_on_connect(acceptInfo.clientSocketId);
          };
          dev.onAcceptError = function (acceptInfo) {
            if (acceptInfo.socketId !== createInfo.socketId) return;
            dev_close('error while listening socket. ' + JSON.stringify(acceptInfo));
          };
          chrome.sockets.tcpServer.onAccept.addListener(dev.onAccept);
          chrome.sockets.tcpServer.onAcceptError.addListener(dev.onAcceptError);

          dev.created = true;

          letAdbHostConnectToDev();
        }); //end of chrome.sockets.tcpServer.getInfo
      }); //end of chrome.sockets.tcpServer.listen
    }); //end of chrome.sockets.tcpServer.create
  }); //end of createWebSocket

  function notifyDevStatusToExternal(err) {
    if (!chromeExtensionIPC) return;
    var msg = err || {port: dev.port, connected: dev.connected};
    console.log('postMessage ' + JSON.stringify(msg) + ' to external: ' + url);
    chromeExtensionIPC.postMessage(msg);
  }

  function dev_close(err) {
    if (!dev.closed) {
      console.log('dev_close');
      dev.closed = true;
      err && notifyDevStatusToExternal(err);
      dev_disconnect();
      dev.serverSocketId && chrome.sockets.tcpServer.close(dev.serverSocketId);
      dev.onAccept && chrome.sockets.tcpServer.onAccept.removeListener(dev.onAccept);
      dev.onAcceptError && chrome.sockets.tcpServer.onAcceptError.removeListener(dev.onAcceptError);
      adbBridgeWebSocket && adbBridgeWebSocket.close();
      if (chromeExtensionIPC) {
        chromeExtensionIPC.disconnect();
        chromeExtensionIPC = null;
      }
    }
  }

  function dev_disconnect() {
    var connectionId = dev.connectionId;
    if (connectionId) {
      console.log(dev.connectionLogHead + 'disconnect');
      delete dev.connectionId;
      chrome.sockets.tcp.onReceive.removeListener(dev.onReceive);
      delete dev.onReceive;
      chrome.sockets.tcp.onReceiveError.removeListener(dev.onReceiveError);
      delete dev.onReceiveError;
      chrome.sockets.tcp.disconnect(connectionId);
      chrome.sockets.tcp.close(connectionId);
      dev.connected = false;
      notifyDevStatusToExternal();
    }
  }

  function dev_on_connect(connectionId) {
    if (dev.connectionId) {
      console.log('[adbConnection ' + connectionId + ']' + 'rejected');
      chrome.sockets.tcp.disconnect(connectionId);
      chrome.sockets.tcp.close(connectionId);
      return;
    }
    dev.connectionId = connectionId;
    dev.connectionLogHead = '[adbConnection ' + connectionId + ']';
    console.log(dev.connectionLogHead + 'accepted');

    dev.onReceive = function (recvInfo) {
      if (recvInfo.socketId !== connectionId) return;
      dev_on_cmd(recvInfo.data);
    };
    dev.onReceiveError = function (recvInfo) {
      if (recvInfo.socketId !== connectionId) return;
      console.log(dev.connectionLogHead + 'recv error: ' + getChromeLastError() + '(' + recvInfo.resultCode + ')');
      dev_disconnect();
    };

    chrome.sockets.tcp.onReceive.addListener(dev.onReceive);
    chrome.sockets.tcp.onReceiveError.addListener(dev.onReceiveError);
    chrome.sockets.tcp.setPaused(connectionId, false);
  }

  function dev_on_cmd(data) {
    var cmd = bufToStr(data.slice(0, 4));
    console.log(dev.connectionLogHead + 'cmd: ' + cmd);
    if (cmd === 'CNXN') {
      dev_on_cmd_CNXN()
    } else {
      console.log(dev.connectionLogHead + 'forward data to WebSocket');
      adbBridgeWebSocket.send(data);
    }
  }

  function dev_on_cmd_CNXN() {
    console.log(dev.connectionLogHead + 'CNXN');
    var t = 'device::ro.product.name=sumatium;ro.product.model=sumatium;ro.product.device=sumatium;';
    var buf = new ArrayBuffer(24 + t.length + 1);
    var dv = new DataView(buf);
    dv.setUint32(0, 0x434e584e); //command
    dv.setUint32(4, 0x01000000, LITTLE_ENDIAN); //arg0: A_VERSION
    dv.setUint32(8, 0x00001000, LITTLE_ENDIAN); //arg1: MAX_PAYLOAD
    dv.setUint32(12, t.length + 1, LITTLE_ENDIAN); //data_length
    dv.setUint32(20, 0xbcb1a7b1); //command ^ 0xffffffff
    var cnt = t.length, i = 0, sum = 0;
    for (; i < cnt; i++) {
      var c = t.charCodeAt(i);
      dv.setUint8(24 + i, c);
      sum += c;
    }
    dv.setUint8(24 + i, 0);
    dv.setUint32(16, sum, LITTLE_ENDIAN); //data_sum

    console.log(dev.connectionLogHead + 'replay CNXN');
    chrome.sockets.tcp.send(dev.connectionId, buf, function (sendInfo) {
      if (sendInfo.resultCode) {
        console.error(dev.connectionLogHead + 'failed to reply CNXN. ' + getChromeLastError() + '(' + sendInfo.resultCode + ')');
      } else {
        console.log(dev.connectionLogHead + 'reply CNXN ok. ' + sendInfo.bytesSent + ' bytes sent');
        dev.connected = true;
      }
      notifyDevStatusToExternal();
    });
  }

  function letAdbHostConnectToDev() {
    console.log('letAdbHostConnectToDev');
    console.log('tcp.create');
    chrome.sockets.tcp.create({}, function (createInfo) {
      console.log('tcp.connect to adbHost');
      chrome.sockets.tcp.connect(createInfo.socketId, '127.0.0.1', 5037, function (resultCode) {
        if (resultCode) {
          console.error('failed to connect to ADB host. ' + getChromeLastError());
          chrome.sockets.tcp.close(createInfo.socketId);
          return notifyDevStatusToExternal();
        }
        console.log('tcp.connect OK');
        var cmd = "host:connect:localhost:" + dev.port;
        cmd = ('000' + cmd.length.toString(16)).slice(-4) + cmd;
        var buf = new ArrayBuffer(cmd.length);
        var dv = new DataView(buf);
        var cnt = cmd.length, i = 0;
        for (; i < cnt; i++) {
          dv.setUint8(i, cmd.charCodeAt(i));
        }
        console.log('send to adbHost');
        return chrome.sockets.tcp.send(createInfo.socketId, buf, function (sendInfo) {
          if (sendInfo.resultCode) {
            console.error('failed to send to ADB host cmd sock. ' + getChromeLastError() + '(' + sendInfo.resultCode + ')');
            notifyDevStatusToExternal();
          } else {
            console.log('send ok. ' + sendInfo.bytesSent + ' bytes sent');
            setTimeout(function () {
              !dev.connected && notifyDevStatusToExternal();
            }, 1000);
          }
          console.log('tcp.close');
          //chrome.sockets.tcp.disconnect(createInfo.socketId);
          chrome.sockets.tcp.close(createInfo.socketId);
        });
      }); //end of chrome.sockets.tcp.connect
    }); //end of chrome.sockets.tcp.create
  } //end of letAdbHostConnectToDev

}); //end of onConnectExternal


function bufToStr(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

function getChromeLastError() {
  return chrome.runtime.lastError && chrome.runtime.lastError.message || '';
}

function connectToWebSocket(url, on_open) {
  console.log('connectToWebSocket ' + url);
  function call_on_open_once(err, ws) {
    if (on_open) {
      on_open(err, ws);
      on_open = null;
    }
  }

  var ws = new WebSocket(url);
  delete ws.URL; //because chrome keep warning on it
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', function () {
    ws.isOpened = true;
    console.log('WebSocket is opened. url: ' + url);
    call_on_open_once(null, ws);
  });
  ws.addEventListener('close', function () {
    var err = 'WebSocket is closed';
    console.log(err + '. url: ' + url);
    ws.isOpened = false;
    call_on_open_once(err);
  });
  debug && ws.addEventListener('message', function (e) {
    console.log('WebSocket message come in. url: ' + url + ' data.length: ' + e.data.length);
  });
  ws.addEventListener('error', function (err) {
    err = 'WebSocket error: ' + err;
    console.err(err + '. url: ' + url);
    call_on_open_once(err);
  });
}
