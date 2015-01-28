'use strict';
var tcp = chrome.sockets.tcp, tcpServer = chrome.sockets.tcpServer;
var LITTLE_ENDIAN = true;
var xhr = new XMLHttpRequest();
/*
xhr.open("GET", "http://ip.jsontest.com/", true);
xhr.onreadystatechange = function() {
  if (xhr.readyState == 4) {
    console.log('xhr res: ' + xhr.responseText);
  }
}
xhr.send();
*/
var adbDevMap = {};

chrome.runtime.onConnectExternal.addListener(function(port) {
    console.log("onConnectExternal");
    function sendResponse(msg) {
        console.log('postMessage to External. msg: ' + JSON.stringify(msg));
        port.postMessage(msg);
        port.disconnect();
    }
    
    port.onMessage.addListener(function(request) {
        console.log("external msg: " + JSON.stringify(request));
        var adbDev = adbDevMap[request.serviceUrl];
        if (request.cmd === 'getAdbDevice') {
            sendResponse(adbDev ? adbDev : 'device not found');
            return;
        }
        if (request.cmd !== 'createAdbDevice') {
            sendResponse('invalid parameter');
            return;
        }
        
        if (adbDev) {
            registerDevToAdbHost(adbDev, sendResponse);
            return;
        }
        
        tcpServer.create({}, function(createInfo) {
            if (createInfo.socketId <= 0) {
                console.error('failed to create tcp server. ' + getLastError());
                sendResponse('failed to create tcp server');
                return;
            }
            console.log('tcpServer created: ' + JSON.stringify(createInfo));
            
            tcpServer.listen(createInfo.socketId, '127.0.0.1', 0 /*random port*/, 0 /*backlog:auto*/, function(resultCode) {
                if (resultCode) {
                    console.error('failed to listen socket. ' + getLastError() + '(' + resultCode + ')');
                    tcpServer.close(createInfo.socketId);
                    sendResponse('failed to listen socket');
                    return;
                }
                console.log('listen ok');
                
                tcpServer.getInfo(createInfo.socketId, function(socketInfo) {
                    console.log('adbDev.port: ' + socketInfo.localPort);
                    adbDev = adbDevMap[request.serviceUrl] = {port: socketInfo.localPort,connected: false};
                    registerDevToAdbHost(adbDev, sendResponse);
                    
                    var onAccept, onAcceptError;
                    tcpServer.onAccept.addListener(onAccept = function(acceptInfo) {
                        if (acceptInfo.socketId !== createInfo.socketId)
                            return;
                        console.log('[adbDev ]incoming connection: ' + acceptInfo.clientSocketId);
                        
                        process_connection(acceptInfo.clientSocketId, request.serviceUrl);
                    });
                    
                    tcpServer.onAcceptError.addListener(onAcceptError = function(acceptInfo) {
                        if (acceptInfo.socketId !== createInfo.socketId)
                            return;
                        console.error('error while listening socket. ' + JSON.stringify(acceptInfo));
                        tcpServer.close(createInfo.socketId);
                        tcpServer.onAccept.removeListener(onAccept);
                        tcpServer.onAcceptError.removeListener(onAcceptError);
                    });
                });
            });
        }); //end of tcpServer.create
    });
});

function registerDevToAdbHost(adbDev, sendResponse) {
    tcp.create({}, function(createInfo) {
        tcp.connect(createInfo.socketId, '127.0.0.1', 5037, function(resultCode) {
            if (resultCode) {
                console.error('failed to connect to ADB host. ' + chrome.runtime.lastError.message);
                sendResponse(adbDev);
                return;
            }
            var cmd = "host:connect:localhost:" + adbDev.port;
            //             var cmd = "host:connect:localhost:55551";
            cmd = ('000' + cmd.length.toString(16)).slice(-4) + cmd;
            var buf = new ArrayBuffer(cmd.length);
            var dv = new DataView(buf);
            var i = 0, cnt = cmd.length;
            for (; i < cnt; i++) {
                dv.setUint8(i, cmd.charCodeAt(i));
            }
            tcp.send(createInfo.socketId, buf, function(sendInfo) {
                if (sendInfo.resultCode) {
                    console.error('failed to send to ADB host. ' + getLastError() + '(' + sendInfo.resultCode + ')');
                    sendResponse(adbDev);
                }
            });
            var total_result = '';
            var onReceive, onReceiveError;
            tcp.onReceive.addListener(onReceive = function(recvInfo) {
                if (recvInfo.socketId !== createInfo.socketId)
                    return;
                var result = bufToStr(recvInfo.data);
                console.log('[from socket_adbhost] recv: ' + result);
                total_result += result;
            });
            tcp.onReceiveError.addListener(onReceiveError = function(recvInfo) {
                if (recvInfo.socketId !== createInfo.socketId)
                    return;
                // seems -100 means closed   (-ENETDOWN), -15 means TCP_FIN (closed by peer)
                console.log('[from socket_adbhost] recv error: ' + getLastError() + JSON.stringify(recvInfo));
                if (total_result.indexOf('connected')) {
                    adbDev.connected = true;
                }
                
                sendResponse(adbDev);
                
                tcp.disconnect(recvInfo.socketId);
                tcp.close(recvInfo.socketId);
                tcp.onReceive.removeListener(onReceive);
                tcp.onReceiveError.removeListener(onReceiveError);
            });
        });
    });
}

function process_connection(socketId, serviceUrl) {
    var logHead = '[adbDev ' + socketId + ']';
    var onReceive, onReceiveError;
    tcp.onReceive.addListener(onReceive = function(recvInfo) {
        if (recvInfo.socketId !== socketId)
            return;
        // recvInfo.data is an arrayBuffer.
        console.log(logHead + 'recv: ' + bufToStr(recvInfo.data.slice(0, 4)));
        if (recvInfo.data.byteLength <= 24) {
            console.log(logHead + 'bad input');
            tcp.close(recvInfo.socketId);
            return;
        }
        var dv = new DataView(recvInfo.data);
        var cmd = dv.getUint32(0);
        
        if (cmd === 0x434e584e) {
            on_adb_connect(socketId);
        } else {
        // xhr.open("POST", serviceUrl, true);
        // xhr.onreadystatechange = function() {
        //   if (xhr.readyState == 4) {
        //     console.log('xhr res: ' + xhr.responseText);
        //   }
        // }
        // xhr.send(recvInfo.data);
        }
    // } else if (cmd === 0x4e45504f) {
    //   on_adb_open_stream(socketId);
    // } else if (cmd === 0x45545257) {
    //   on_adb_got_stream(socketId);
    // } else if (cmd === 0x45534c43) {
    //   on_adb_close_stream(socketId);
    // } else if (cmd === 0x434e5953) {
    //   on_adb_sync(socketId);
    // }
    });
    
    tcp.onReceiveError.addListener(onReceiveError = function(recvInfo) {
        if (recvInfo.socketId !== socketId)
            return;
        // seems -100 means closed   (-ENETDOWN)
        console.log(logHead + 'recv error: ' + getLastError() + '(' + recvInfo.resultCode + ')');
        
        tcp.disconnect(recvInfo.socketId);
        tcp.close(recvInfo.socketId);
        tcp.onReceive.removeListener(onReceive);
        tcp.onReceiveError.removeListener(onReceiveError);
    });
    
    tcp.setPaused(socketId, false);
}

function on_adb_connect(socketId) {
    var logHead = '[adbDev ' + socketId + ']';
    var t = 'device::ro.product.name=sumatium;ro.product.model=sumatium;ro.product.device=sumatium;';
    var buf = new ArrayBuffer(24 + t.length + 1);
    var dv = new DataView(buf);
    dv.setUint32(0, 0x434e584e); //command
    dv.setUint32(4, 0x01000000, LITTLE_ENDIAN); //arg0
    dv.setUint32(8, 0x00001000, LITTLE_ENDIAN); //arg1
    dv.setUint32(12, t.length + 1, LITTLE_ENDIAN); //data_length
    dv.setUint32(20, 0xbcb1a7b1); //command ^ 0xffffffff
    var cnt = t.length, i = 0, j = 24, sum = 0;
    for (; i < cnt; i++, j++) {
        var c = t.charCodeAt(i);
        dv.setUint8(j, c);
        sum += c;
    }
    dv.setUint32(16, sum, LITTLE_ENDIAN); //data_sum
    
    tcp.send(socketId, buf, function(sendInfo) {
        if (sendInfo.resultCode)
            console.error(logHead + 'failed to reply CNXN. ' + getLastError() + '(' + sendInfo.resultCode + ')');
        else
            console.log(logHead + 'reply CNXN ok');
    });
}

function bufToStr(buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
}

function getLastError() {
    return chrome.runtime.lastError && chrome.runtime.lastError.message || '';
}
