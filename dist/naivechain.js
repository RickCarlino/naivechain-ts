"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var crypto_js_1 = require("crypto-js");
var express = require("express");
var bodyParser = require("body-parser");
var WebSocket = require("ws");
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = parseInt(process.env.P2P_PORT || "", 10) || 6001;
var PEERS = process.env.PEERS;
exports.initialPeers = PEERS ? PEERS.split(',') : [];
var MessageType;
(function (MessageType) {
    MessageType[MessageType["QUERY_LATEST"] = 0] = "QUERY_LATEST";
    MessageType[MessageType["QUERY_ALL"] = 1] = "QUERY_ALL";
    MessageType[MessageType["RESPONSE_BLOCKCHAIN"] = 2] = "RESPONSE_BLOCKCHAIN";
})(MessageType || (MessageType = {}));
;
var Block = /** @class */ (function () {
    function Block(index, previousHash, timestamp, data, hash) {
        this.index = index;
        this.previousHash = previousHash;
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash;
        this.previousHash = previousHash.toString();
        this.hash = hash.toString();
    }
    return Block;
}());
var sockets = [];
var getGenesisBlock = function () {
    return new Block(0, "0", 1465154705, "my genesis block!!", "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};
var blockchain = [getGenesisBlock()];
exports.initHttpServer = function () {
    var app = express();
    app.use(bodyParser.json());
    app.get('/blocks', function (req, res) { return res.send(JSON.stringify(blockchain)); });
    app.post('/mineBlock', function (req, res) {
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));
        res.send();
    });
    app.get('/peers', function (req, res) {
        res.send(sockets.map(function (s) { return s.url; }));
    });
    app.post('/addPeer', function (req, res) {
        exports.connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, function () { return console.log('Listening http on port: ' +
        http_port); });
};
exports.initP2PServer = function () {
    var server = new WebSocket.Server({ port: p2p_port });
    server.on('connection', function (ws) { return initConnection(ws); });
    console.log('listening websocket p2p port on: ' + p2p_port);
};
var initConnection = function (ws) {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
};
var initMessageHandler = function (ws) {
    ws.on('message', function (data) {
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};
var initErrorHandler = function (ws) {
    var closeConnection = function (ws) {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', function () { return closeConnection(ws); });
    ws.on('error', function () { return closeConnection(ws); });
};
var generateNextBlock = function (blockData) {
    var previousBlock = getLatestBlock();
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
    var prevHash = previousBlock.hash;
    var nextHash = calculateHash(nextIndex, prevHash, nextTimestamp, blockData);
    return new Block(nextIndex, prevHash, nextTimestamp, blockData, nextHash);
};
var calculateHashForBlock = function (block) {
    var index = block.index, previousHash = block.previousHash, timestamp = block.timestamp, data = block.data;
    return calculateHash(index, previousHash, timestamp, data);
};
var calculateHash = function (index, previousHash, timestamp, data) {
    return crypto_js_1.SHA256(index + previousHash + timestamp + data).toString();
};
var addBlock = function (newBlock) {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
};
var isValidNewBlock = function (newBlock, previousBlock) {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    }
    else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    }
    else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) +
            ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' +
            newBlock.hash);
        return false;
    }
    return true;
};
exports.connectToPeers = function (newPeers) {
    newPeers.forEach(function (peer) {
        var ws = new WebSocket(peer);
        ws.on('open', function () { return initConnection(ws); });
        ws.on('error', function () {
            console.log('connection failed');
        });
    });
};
var handleBlockchainResponse = function (message) {
    var payload = (JSON.parse(message.data || "null") || []);
    var receivedBlocks = payload.sort(function (b1, b2) { return (b1.index - b2.index); });
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' +
            latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        }
        else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        }
        else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    }
    else {
        console.log('received blockchain is not longer than received blockchain. ' +
            'Do nothing');
    }
};
var replaceChain = function (newBlocks) {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain ' +
            'with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    }
    else {
        console.log('Received blockchain invalid');
    }
};
var isValidChain = function (blockchainToValidate) {
    var currentBlock = JSON.stringify(blockchainToValidate[0]);
    var firstBlock = JSON.stringify(getGenesisBlock());
    if (currentBlock !== firstBlock) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        }
        else {
            return false;
        }
    }
    return true;
};
var getLatestBlock = function () { return blockchain[blockchain.length - 1]; };
var queryChainLengthMsg = function () { return ({ 'type': MessageType.QUERY_LATEST }); };
var queryAllMsg = function () { return ({ 'type': MessageType.QUERY_ALL }); };
var responseChainMsg = function () { return ({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
}); };
var responseLatestMsg = function () { return ({
    type: MessageType.RESPONSE_BLOCKCHAIN,
    data: JSON.stringify([getLatestBlock()])
}); };
var write = function (ws, message) { return ws.send(JSON.stringify(message)); };
var broadcast = function (message) { return sockets.forEach(function (socket) { return write(socket, message); }); };
