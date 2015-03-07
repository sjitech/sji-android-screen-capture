'use strict';
var debug = true;
if (false === true) var chrome = console.log({runtime: {}, onConnectExternal: {}, onDisconnect: {}, onMessage: {}, resultCode: 0, tcp: {}, tcpServer: {}, getInfo: Function, onAccept: {}, onAcceptError: {}, clientSocketId: 0, onReceive: {}, onReceiveError: {}, getUint32: Function, setUint32: Function, setUint8: Function, setPaused: Function, listen: Function, sockets: {}, addListener: Function, localPort: 0, removeListener: Function, disconnect: Function, connect: Function, bytesSent: 0, socketId: 0, __end: 0});

chrome.runtime.onConnectExternal.addListener(function (chromeExtensionIPC) {
  var url = chromeExtensionIPC.name, adbBridgeWebSocket, serverSocketId, serverPort, connectionId, connected = false;
  var devTag = makeLogHead(url), conTag = devTag + '[connection]', wsTag = devTag + '[AdbBridgeWebSocket]', adbHostTag = devTag + '[localhost:5037]';
  console.log('-------------------' + chromeExtensionIPC.test);
  console.log(devTag + ' connected from web page');
  chromeExtensionIPC.postMessage('hello');

  chromeExtensionIPC.onDisconnect.addListener(function () {
    console.log(devTag + ' disconnected from web page');
    chromeExtensionIPC = null;
  });

  connectToAdbBridgeWebSocket(function /*on_ok*/() {
    adbBridgeWebSocket.addEventListener('message', function (e) {
      debug && console.log(wsTag + ' read  ' + e.data.length + ' bytes and forward to adb host');
      chrome.sockets.tcp.send(connectionId, e.data, function (sendInfo) {
        (debug || sendInfo.resultCode) && console.log(conTag + !sendInfo.resultCode ? (' write ' + sendInfo.bytesSent + ' bytes') : (' write error: ' + sendInfo.resultCode + ' ' + getChromeLastError()));
        sendInfo.resultCode && dev_close('failed to write response to adb host');
      });
      !connected && (connected = true) && notifyDevStatusToExternal('connected');
    });
    createTcpServer(function /*on_ok*/() {
      registerToLocalAdbDaemon();
    });
  });

  function handle_adb_connection(_connectionId) {
    if (connectionId) {
      console.log(conTag + ' rejected');
      chrome.sockets.tcp.disconnect(_connectionId);
      chrome.sockets.tcp.close(_connectionId);
      return;
    }
    connectionId = _connectionId;
    console.log(conTag + ' accepted');

    chrome.sockets.tcp.onReceive.addListener(onReceive);
    chrome.sockets.tcp.onReceiveError.addListener(onReceiveError);
    chrome.sockets.tcp.setPaused(connectionId, false);
  }

  function onReceive(info) {
    if (info.socketId !== connectionId) return;
    console.log(conTag + ' read  ' + info.data.length + ' bytes and forward to AdbBridgeWebSocket');
    adbBridgeWebSocket.send(info.data);
  }

  function onReceiveError(info) {
    if (info.socketId !== connectionId) return;
    console.log(conTag + ' read  error: ' + info.resultCode + ' ' + getChromeLastError());
    dev_disconnect();
  }

  function registerToLocalAdbDaemon() {
    console.log(devTag + ' register to default local adb daemon');
    chrome.sockets.tcp.create({}, function (createInfo) {
      console.log(adbHostTag + ' connect');
      return chrome.sockets.tcp.connect(createInfo.socketId, '127.0.0.1', 5037, function (resultCode) {
        if (resultCode) {
          console.log(adbHostTag + ' connect error: ' + resultCode + ' ' + getChromeLastError());
          chrome.sockets.tcp.close(createInfo.socketId);
          return notifyDevStatusToExternal('failed to connect to default local adb daemon');
        }
        var cmd = "host:connect:localhost:" + serverPort;
        cmd = ('000' + cmd.length.toString(16)).slice(-4) + cmd;
        var buf = new ArrayBuffer(cmd.length);
        var dv = new DataView(buf);
        var cnt = cmd.length, i = 0;
        for (; i < cnt; i++) {
          dv.setUint8(i, cmd.charCodeAt(i));
        }
        console.log(adbHostTag + ' write ' + cmd.length + ' bytes: "' + cmd + '"');
        return chrome.sockets.tcp.send(createInfo.socketId, buf, function (sendInfo) {
          if (sendInfo.resultCode) {
            console.log(adbHostTag + ' write error: ' + sendInfo.resultCode + ' ' + getChromeLastError());
            notifyDevStatusToExternal('failed to write to default local adb daemon');
          }
          console.log(adbHostTag + ' close');
          //chrome.sockets.tcp.disconnect(createInfo.socketId);
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
      console.log(wsTag + ' opened');
      on_ok();
    });
    adbBridgeWebSocket.addEventListener('close', function () {
      if (!adbBridgeWebSocket) return;
      console.log(wsTag + ' closed');
      adbBridgeWebSocket = null;
      dev_close('AdbBridgeWebSocket is closed');
    });
    adbBridgeWebSocket.addEventListener('error', function (err) {
      console.log(wsTag + ' ' + err);
      dev_close('AdbBridgeWebSocket error');
    });
  }

  function createTcpServer(on_ok) {
    chrome.sockets.tcpServer.create({}, function (createInfo) {
      serverSocketId = createInfo.socketId;
      chrome.sockets.tcpServer.listen(createInfo.socketId, '127.0.0.1', 0 /*random port*/, 0 /*backlog:auto*/, function (resultCode) {
        if (resultCode) {
          console.log(devTag + '[tcpServer] listen error: ' + resultCode + ' ' + getChromeLastError());
          return dev_close('failed to listen tcp server');
        }
        return chrome.sockets.tcpServer.getInfo(createInfo.socketId, function (socketInfo) {
          console.log(devTag + '[tcpServer] listening at port: ' + socketInfo.localPort);
          serverPort = socketInfo.localPort;

          chrome.sockets.tcpServer.onAccept.addListener(onAccept);
          chrome.sockets.tcpServer.onAcceptError.addListener(onAcceptError);

          on_ok();
        }); //end of chrome.sockets.tcpServer.getInfo
      }); //end of chrome.sockets.tcpServer.listen
    }); //end of chrome.sockets.tcpServer.create
  } //end of createTcpServer

  function onAccept(info) {
    if (info.socketId !== serverSocketId) return;
    handle_adb_connection(info.clientSocketId);
  }

  function onAcceptError(info) {
    if (info.socketId !== serverSocketId) return;
    console.log(devTag + '[tcpServer] accept error: ' + info.resultCode + ' ' + getChromeLastError());
    dev_close('failed to accept connection to tcp server');
  }

  function dev_close(err) {
    if (!dev_close.called) return;
    console.log(devTag + ' close' + (err ? ' reason: ' + err : ''));
    dev_close.called = true;
    notifyDevStatusToExternal(err || 'closed');
    dev_disconnect();
    if (serverSocketId) {
      chrome.sockets.tcpServer.onAccept.removeListener(onAccept);
      chrome.sockets.tcpServer.onAcceptError.removeListener(onAcceptError);
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

  function dev_disconnect() {
    if (!connectionId) return;
    console.log(conTag + ' disconnect');
    chrome.sockets.tcp.onReceive.removeListener(onReceive);
    chrome.sockets.tcp.onReceiveError.removeListener(onReceiveError);
    chrome.sockets.tcp.disconnect(connectionId);
    chrome.sockets.tcp.close(connectionId);
    connectionId = 0;
    connected = false;
    !dev_close.called && notifyDevStatusToExternal('disconnected');
  }

  function notifyDevStatusToExternal(status) {
    if (!chromeExtensionIPC) return;
    var info = {conId: serverPort ? 'localhost:' + serverPort : '', connected: connected, status: status};
    console.log(devTag + ' postMessage ' + JSON.stringify(info) + ' to web page');
    chromeExtensionIPC.postMessage(info);
  }

  function makeLogHead(url) {
    var match = url.match(/\bdevice=([^&]+)/), id = match ? decodeURIComponent(match[1]) : url;
    return '[VirtAdbDev ' + id + ']';
  }

  function getChromeLastError() {
    return chrome.runtime.lastError && chrome.runtime.lastError.message || '';
  }
}); //end of onConnectExternal
