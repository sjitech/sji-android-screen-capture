'use strict';
var debug = true;
if (false === true) var chrome = console.log({runtime: {}, onConnectExternal: {}, onDisconnect: {}, onMessage: {}, resultCode: 0, tcp: {}, tcpServer: {}, getInfo: Function, onAccept: {}, onAcceptError: {}, clientSocketId: 0, onReceive: {}, onReceiveError: {}, getUint32: Function, setUint32: Function, setUint8: Function, setPaused: Function, listen: Function, sockets: {}, addListener: Function, localPort: 0, removeListener: Function, disconnect: Function, connect: Function, bytesSent: 0, socketId: 0, __end: 0});

chrome.runtime.onConnectExternal.addListener(function (chromeExtensionIPC) {
  console.log('connected from web page. Args: ', chromeExtensionIPC.name);
  var args = JSON.parse(chromeExtensionIPC.name), url = args.url, prefServerPort = args.port;
  var adbBridgeWebSocket, serverSocketId, serverPort, transportSocketId, connected = false;
  var devTag = makeLogHead(url), transTag = devTag + '[LocalAdbTransport]', wsTag = devTag + '[AdbBridgeWebSocket]', adbHostTag = devTag + '[->localhost:5037]';
  chromeExtensionIPC.postMessage('hello');

  chromeExtensionIPC.onDisconnect.addListener(function () {
    console.log(devTag + ' disconnected from web page');
    chromeExtensionIPC = null;
    cleanup('disconnected from web page');
  });

  connectToAdbBridgeWebSocket(function /*on_ok*/() {
    adbBridgeWebSocket.addEventListener('message', function (e) {
      debug && console.log(wsTag + ' read  ' + hexUint32(e.data.byteLength) + ' bytes and forward to LocalAdbTransport');
      chrome.sockets.tcp.send(transportSocketId, e.data, function (info) {
        (debug || info.resultCode) && console.log(transTag + (!info.resultCode ? (' write ' + hexUint32(info.bytesSent) + ' bytes') : (' write error: ' + info.resultCode + ' ' + getChromeLastError())));
        info.resultCode && cleanup('failed to write to LocalAdbTransport');
      });
      !connected && (connected = true) && notifyStatus('connected');
    });
    createTcpServer(function /*on_ok*/() {
      chrome.sockets.tcpServer.onAccept.addListener(onAccept);
      chrome.sockets.tcpServer.onAcceptError.addListener(onAccept);
      registerToLocalAdbDaemon();
    });
  });

  function onAccept(info) {
    if (info.socketId !== serverSocketId) return;
    console.log(devTag + '[tcpServer]' + (!info.resultCode ? ('accept connection') : ('accept connection error: ' + info.resultCode + ' ' + getChromeLastError())));
    !info.resultCode ? handle_LocalAdbTransport(info.clientSocketId) : cleanup('failed to accept connection');
  }

  function handle_LocalAdbTransport(socketId) {
    if (transportSocketId) {
      console.log(devTag + ' abandon accepted connection due to already connected');
      chrome.sockets.tcp.disconnect(socketId);
      chrome.sockets.tcp.close(socketId);
      return;
    }
    transportSocketId = socketId;
    chrome.sockets.tcp.onReceive.addListener(LocalAdbTransport_onReceive);
    chrome.sockets.tcp.onReceiveError.addListener(LocalAdbTransport_onReceive);
    chrome.sockets.tcp.setPaused(socketId, false);
  }

  function LocalAdbTransport_onReceive(info) {
    if (info.socketId !== transportSocketId) return;
    console.log(transTag + (!info.resultCode ? (' read  ' + hexUint32(info.data.byteLength) + ' bytes' + (adbBridgeWebSocket ? ' and forward to AdbBridgeWebSocket' : '')) : (' read  error: ' + info.resultCode + ' ' + getChromeLastError())));
    !info.resultCode ? adbBridgeWebSocket ? adbBridgeWebSocket.send(info.data) : '' : LocalAdbTransport_close();
  }

  function registerToLocalAdbDaemon() {
    console.log(devTag + ' register to local adb daemon');
    chrome.sockets.tcp.create({}, function (createInfo) {
      console.log(adbHostTag + ' connect');
      return chrome.sockets.tcp.connect(createInfo.socketId, '127.0.0.1', 5037, function (resultCode) {
        if (resultCode) {
          console.log(adbHostTag + ' connect error: ' + resultCode + ' ' + getChromeLastError());
          chrome.sockets.tcp.close(createInfo.socketId);
          return notifyStatus('failed to connect to local adb daemon');
        }
        var cmd = "host:connect:localhost:" + serverPort;
        cmd = ('000' + cmd.length.toString(16)).slice(-4) + cmd;
        var buf = new ArrayBuffer(cmd.length);
        var dv = new DataView(buf);
        var cnt = cmd.length, i = 0;
        for (; i < cnt; i++) {
          dv.setUint8(i, cmd.charCodeAt(i));
        }
        console.log(adbHostTag + ' write "' + cmd + '"');
        return chrome.sockets.tcp.send(createInfo.socketId, buf, function (info) {
          console.log(adbHostTag + (!info.resultCode ? (' write OK. Now close') : (' write error: ' + info.resultCode + ' ' + getChromeLastError())));
          info.resultCode && notifyStatus('failed to write to local adb daemon');
          chrome.sockets.tcp.close(createInfo.socketId);
        });
      }); //end of chrome.sockets.tcp.connect
    }); //end of chrome.sockets.tcp.create
  } //end of letAdbHostConnectToDev

  function connectToAdbBridgeWebSocket(on_ok) {
    console.log(wsTag + ' connect');

    adbBridgeWebSocket = new WebSocket(url);
    adbBridgeWebSocket.binaryType = 'arraybuffer';
    delete adbBridgeWebSocket.URL; //because chrome keep warning on it

    adbBridgeWebSocket.addEventListener('open', function () {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' opened');
      on_ok();
    });
    adbBridgeWebSocket.addEventListener('close', function () {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' closed');
      adbBridgeWebSocket = null;
      cleanup('AdbBridgeWebSocket is closed');
    });
    adbBridgeWebSocket.addEventListener('error', function (err) {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' ' + err);
      cleanup('AdbBridgeWebSocket error');
    });
  }

  function createTcpServer(on_ok) {
    chrome.sockets.tcpServer.create({}, function (createInfo) {
      serverSocketId = createInfo.socketId;
      chrome.sockets.tcpServer.listen(createInfo.socketId, '127.0.0.1', prefServerPort || 0 /*random port*/, 0 /*backlog:auto*/, function (resultCode) {
        if (resultCode) {
          console.log(devTag + '[tcpServer] listen error: ' + resultCode + ' ' + getChromeLastError());
          return cleanup('failed to listen tcp server');
        }
        return chrome.sockets.tcpServer.getInfo(createInfo.socketId, function (info) {
          console.log(devTag + '[tcpServer] listening at port: ' + info.localPort);
          serverPort = info.localPort;
          on_ok();
        }); //end of chrome.sockets.tcpServer.getInfo
      }); //end of chrome.sockets.tcpServer.listen
    }); //end of chrome.sockets.tcpServer.create
  } //end of createTcpServer

  function cleanup(reason) {
    if (cleanup.called) return;
    console.log(devTag + ' cleanup. reason: ' + reason);
    cleanup.called = true;
    notifyStatus(reason);
    LocalAdbTransport_close();
    if (serverSocketId) {
      chrome.sockets.tcpServer.onAccept.removeListener(onAccept);
      chrome.sockets.tcpServer.onAcceptError.removeListener(onAccept);
      chrome.sockets.tcpServer.close(serverSocketId);
      serverSocketId = 0;
      serverPort = 0;
    }
    if (adbBridgeWebSocket) {
      adbBridgeWebSocket.close();
      adbBridgeWebSocket = null;
    }
    if (chromeExtensionIPC) {
      chromeExtensionIPC.disconnect();
      chromeExtensionIPC = null;
    }
  }

  function LocalAdbTransport_close() {
    if (!transportSocketId) return;
    console.log(transTag + ' disconnect');
    chrome.sockets.tcp.onReceive.removeListener(LocalAdbTransport_onReceive);
    chrome.sockets.tcp.onReceiveError.removeListener(LocalAdbTransport_onReceive);
    chrome.sockets.tcp.disconnect(transportSocketId);
    chrome.sockets.tcp.close(transportSocketId);
    transportSocketId = 0;
    connected = false;
    !cleanup.called && notifyStatus('LocalAdbTransport is closed');
  }

  function notifyStatus(status) {
    if (!chromeExtensionIPC) return;
    var info = {conId: serverPort ? 'localhost:' + serverPort : '', connected: connected, status: status};
    console.log(devTag + ' announce ' + JSON.stringify(info));
    chromeExtensionIPC.postMessage(info);
  }

  function makeLogHead(url) {
    var match = url.match(/\bdevice=([^&]+)/), id = match ? decodeURIComponent(match[1]) : url;
    return '[VirtAdbDev ' + id + ']';
  }

  function getChromeLastError() {
    return chrome.runtime.lastError && chrome.runtime.lastError.message || '';
  }

  function hexUint32(d) {
    return ('0000' + d.toString(16)).slice(-4);
  }
}); //end of onConnectExternal
