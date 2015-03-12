'use strict';
if (false === true) var chrome = {runtime: {}, onConnectExternal: {}, onDisconnect: {}, onMessage: {}, resultCode: 0, tcp: {}, tcpServer: {}, getInfo: Function, onAccept: {}, onAcceptError: {}, clientSocketId: 0, onReceive: {}, onReceiveError: {}, getUint32: Function, setUint32: Function, setUint8: Function, setPaused: Function, listen: Function, sockets: {}, addListener: Function, localPort: 0, removeListener: Function, disconnect: Function, connect: Function, bytesSent: 0, socketId: 0, __end: 0};

chrome.runtime.onConnectExternal.addListener(function (chromeExtensionIPC) {
  console.log(chromeExtensionIPC.name);
  var args = JSON.parse(chromeExtensionIPC.name), url = args.url, prefServerPort = args.port, debug = args.debug;
  var adbBridgeWebSocket, serverSocketId, serverPort, transportSocketId, connected = false;
  var devTag = makeLogHead(url), wsTag = devTag + '[AdbBridgeWebSocket]', transTag = devTag + '[LocalAdbTransport]', serverTag = devTag + '[LocalAdbTransportTcpServer]', adbHostTag = devTag + '[->localhost:5037]';
  chromeExtensionIPC.postMessage('hello');

  chromeExtensionIPC.onDisconnect.addListener(function () {
    console.log(devTag + ' disconnected from web page');
    chromeExtensionIPC = null;
    cleanup('disconnected from web page');
  });

  AdbBridgeWebSocket_connect(function /*on_ok*/() {
    adbBridgeWebSocket.addEventListener('message', function (e) {
      debug && console.log(wsTag + ' read  ' + hexUint32(e.data.byteLength) + ' bytes' + (debug ? '' : ' and forward to LocalAdbTransport'));
      chrome.sockets.tcp.send(transportSocketId, e.data, function (info) {
        (debug || info.resultCode) && console.log(transTag + (!info.resultCode ? (' write ' + hexUint32(info.bytesSent) + ' bytes') : (' write error: ' + info.resultCode + ' ' + getChromeLastError())));
        info.resultCode && cleanup('failed to write to LocalAdbTransport');
      });
      !connected && (connected = true) && notifyStatus('connected');
    });
    LocalAdbTransportTcpServer_create(function /*on_ok*/() {
      chrome.sockets.tcpServer.onAccept.addListener(LocalAdbTransportTcpServer_onAccept);
      chrome.sockets.tcpServer.onAcceptError.addListener(LocalAdbTransportTcpServer_onAccept);
      registerToLocalAdbDaemon();
    });
  });

  function LocalAdbTransportTcpServer_onAccept(info) {
    if (info.socketId !== serverSocketId) return;
    console.log(serverTag + (!info.resultCode ? (' connected') : (' accept connection error: ' + info.resultCode + ' ' + getChromeLastError())));
    !info.resultCode ? LocalAdbTransport_init(info.clientSocketId) : cleanup('failed to accept connection');
  }

  function LocalAdbTransport_init(socketId) {
    if (transportSocketId) {
      console.log(devTag + ' abandon connection');
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
    (debug || info.resultCode) && console.log(transTag + (!info.resultCode ? (' read  ' + hexUint32(info.data.byteLength) + ' bytes' + (adbBridgeWebSocket && !debug ? ' and forward to AdbBridgeWebSocket' : '')) : (' read  error: ' + info.resultCode + ' ' + getChromeLastError())));
    !info.resultCode ? adbBridgeWebSocket ? adbBridgeWebSocket.send(info.data) : '' : LocalAdbTransport_close();
  }

  function registerToLocalAdbDaemon() {
    debug && console.log(devTag + ' register to local adb daemon');
    chrome.sockets.tcp.create({}, function (createInfo) {
      debug && console.log(adbHostTag + ' connect');
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
        debug && console.log(adbHostTag + ' write "' + cmd + '"');
        return chrome.sockets.tcp.send(createInfo.socketId, buf, function (info) {
          (debug || info.resultCode) && console.log(adbHostTag + (!info.resultCode ? (' write OK. Now close') : (' write error: ' + info.resultCode + ' ' + getChromeLastError())));
          info.resultCode && notifyStatus('failed to write to local adb daemon');
          chrome.sockets.tcp.close(createInfo.socketId);
        });
      }); //end of chrome.sockets.tcp.connect
    }); //end of chrome.sockets.tcp.create
  }

  function AdbBridgeWebSocket_connect(on_ok) {
    debug && console.log(wsTag + ' connect');

    adbBridgeWebSocket = new WebSocket(url);
    adbBridgeWebSocket.binaryType = 'arraybuffer';
    delete adbBridgeWebSocket.URL; //because chrome keep warning on it

    adbBridgeWebSocket.addEventListener('open', function () {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' opened');
      on_ok();
    });
    adbBridgeWebSocket.addEventListener('close', function (e) {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' closed.' + (e.code ? ' code: ' + e.code : '') + (e.reason ? ' reason: ' + e.reason : ''));
      adbBridgeWebSocket = null;
      cleanup('AdbBridgeWebSocket is closed');
    });
    adbBridgeWebSocket.addEventListener('error', function () {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' error');
      cleanup('AdbBridgeWebSocket error');
    });
  }

  function LocalAdbTransportTcpServer_create(on_ok) {
    chrome.sockets.tcpServer.create({}, function (createInfo) {
      serverSocketId = createInfo.socketId;
      chrome.sockets.tcpServer.listen(createInfo.socketId, '127.0.0.1', prefServerPort || 0 /*random port*/, /*backlog:*/0, function (resultCode) {
        if (resultCode) {
          console.log(serverTag + ' listen error: ' + resultCode + ' ' + getChromeLastError());
          return cleanup('failed to listen at ' + (prefServerPort ? 'specified port' : 'any port') + ' in localhost');
        }
        return chrome.sockets.tcpServer.getInfo(createInfo.socketId, function (info) {
          if (!info.localPort) {
            console.log(serverTag + ' listen error: ' + getChromeLastError());
            return cleanup('failed to listen at ' + (prefServerPort ? 'specified port' : 'any port') + ' in localhost');
          }
          debug && console.log(serverTag + ' listening at port ' + info.localPort + ' in localhost');
          serverPort = info.localPort;
          on_ok();
        }); //end of chrome.sockets.tcpServer.getInfo
      }); //end of chrome.sockets.tcpServer.listen
    }); //end of chrome.sockets.tcpServer.create
  }

  function cleanup(reason) {
    if (cleanup.called) return;
    console.log(devTag + ' cleanup. reason: ' + reason);
    cleanup.called = true;
    notifyStatus(reason);
    LocalAdbTransport_close();
    if (serverSocketId) {
      chrome.sockets.tcpServer.onAccept.removeListener(LocalAdbTransportTcpServer_onAccept);
      chrome.sockets.tcpServer.onAcceptError.removeListener(LocalAdbTransportTcpServer_onAccept);
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
    console.log(transTag + ' close');
    chrome.sockets.tcp.onReceive.removeListener(LocalAdbTransport_onReceive);
    chrome.sockets.tcp.onReceiveError.removeListener(LocalAdbTransport_onReceive);
    chrome.sockets.tcp.close(transportSocketId);
    transportSocketId = 0;
    connected = false;
    !cleanup.called && notifyStatus('LocalAdbTransport is closed');
  }

  function notifyStatus(status) {
    if (!chromeExtensionIPC) return;
    var info = {conId: serverPort ? 'localhost:' + serverPort : '', connected: connected, status: status};
    console.log(devTag + ' ' + JSON.stringify(info));
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
    var h = d.toString(16);
    return d <= 0xf ? '000' + h : d <= 0xff ? '00' + h : d <= 0xfff ? '0' + h : d <= 0xffff ? h : h;
  }
});
