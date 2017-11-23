import { SHA256 } from "crypto-js";
import * as express from "express";
import * as bodyParser from "body-parser";
import * as WebSocket from "ws";

const http_port = process.env.HTTP_PORT || 3001;
const p2p_port = parseInt(process.env.P2P_PORT || "", 10) || 6001;
const { PEERS } = process.env;
export const initialPeers = PEERS ? PEERS.split(',') : [];

enum MessageType {
  QUERY_LATEST = 0,
  QUERY_ALL = 1,
  RESPONSE_BLOCKCHAIN = 2
};

interface Message {
  type: MessageType;
  data?: string;
}

export class Block {
  constructor(public index: number,
    public previousHash: string,
    public timestamp: number,
    public data: string,
    public hash: string) {
    this.previousHash = previousHash.toString();
    this.hash = hash.toString();
  }
}

const sockets: WebSocket[] = [];

const getGenesisBlock = () => {
  return new Block(0,
    "0",
    1465154705,
    "my genesis block!!",
    "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};

var blockchain = [getGenesisBlock()];

export const initHttpServer = () => {
  const app = express();
  app.use(bodyParser.json());

  app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));
  app.post('/mineBlock', (req, res) => {
    const newBlock = generateNextBlock(req.body.data);
    addBlock(newBlock);
    broadcast(responseLatestMsg());
    console.log('block added: ' + JSON.stringify(newBlock));
    res.send();
  });
  app.get('/peers', (req, res) => {
    res.send(sockets.map((s: WebSocket) => s.url));
  });
  app.post('/addPeer', (req, res) => {
    connectToPeers([req.body.peer]);
    res.send();
  });
  app.listen(http_port, () => console.log('Listening http on port: ' +
    http_port));
};


export const initP2PServer = () => {
  const server = new WebSocket.Server({ port: p2p_port });
  server.on('connection', (ws: WebSocket) => initConnection(ws));
  console.log('listening websocket p2p port on: ' + p2p_port);

};

const initConnection = (ws: WebSocket) => {
  sockets.push(ws);
  initMessageHandler(ws);
  initErrorHandler(ws);
  write(ws, queryChainLengthMsg());
};

const initMessageHandler = (ws: WebSocket) => {
  ws.on('message', (data: string) => {
    const message = JSON.parse(data);
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

const initErrorHandler = (ws: WebSocket) => {
  const closeConnection = (ws: WebSocket) => {
    console.log('connection failed to peer: ' + ws.url);
    sockets.splice(sockets.indexOf(ws), 1);
  };
  ws.on('close', () => closeConnection(ws));
  ws.on('error', () => closeConnection(ws));
};


const generateNextBlock = (blockData: string) => {
  const previousBlock = getLatestBlock();
  const nextIndex = previousBlock.index + 1;
  const nextTimestamp = new Date().getTime() / 1000;
  const prevHash = previousBlock.hash;
  const nextHash =
    calculateHash(nextIndex, prevHash, nextTimestamp, blockData);
  return new Block(nextIndex, prevHash, nextTimestamp, blockData, nextHash);
};

const calculateHashForBlock = (block: Block) => {
  const { index, previousHash, timestamp, data } = block;
  return calculateHash(index, previousHash, timestamp, data);
};

const calculateHash =
  (index: number, previousHash: string, timestamp: number, data: string) => {
    return SHA256(index + previousHash + timestamp + data).toString();
  };

const addBlock = (newBlock: Block) => {
  if (isValidNewBlock(newBlock, getLatestBlock())) {
    blockchain.push(newBlock);
  }
};

const isValidNewBlock = (newBlock: Block, previousBlock: Block) => {
  if (previousBlock.index + 1 !== newBlock.index) {
    console.log('invalid index');
    return false;
  } else if (previousBlock.hash !== newBlock.previousHash) {
    console.log('invalid previoushash');
    return false;
  } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
    console.log(typeof (newBlock.hash) +
      ' ' + typeof calculateHashForBlock(newBlock));
    console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' +
      newBlock.hash);
    return false;
  }
  return true;
};

export const connectToPeers = (newPeers: string[]) => {
  newPeers.forEach((peer) => {
    const ws = new WebSocket(peer);
    ws.on('open', () => initConnection(ws));
    ws.on('error', () => {
      console.log('connection failed')
    });
  });
};

const handleBlockchainResponse = (message: Message) => {
  const payload: Block[] = (JSON.parse(message.data || "null") || []);
  const receivedBlocks =
    payload.sort((b1: Block, b2: Block) => (b1.index - b2.index));
  const latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
  const latestBlockHeld = getLatestBlock();
  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log('blockchain possibly behind. We got: ' +
      latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
    if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
      console.log("We can append the received block to our chain");
      blockchain.push(latestBlockReceived);
      broadcast(responseLatestMsg());
    } else if (receivedBlocks.length === 1) {
      console.log("We have to query the chain from our peer");
      broadcast(queryAllMsg());
    } else {
      console.log("Received blockchain is longer than current blockchain");
      replaceChain(receivedBlocks);
    }
  } else {
    console.log('received blockchain is not longer than received blockchain. ' +
      'Do nothing');
  }
};

const replaceChain = (newBlocks: Block[]) => {
  if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
    console.log('Received blockchain is valid. Replacing current blockchain ' +
      'with received blockchain');
    blockchain = newBlocks;
    broadcast(responseLatestMsg());
  } else {
    console.log('Received blockchain invalid');
  }
};

const isValidChain = (blockchainToValidate: Block[]) => {
  const currentBlock = JSON.stringify(blockchainToValidate[0]);
  const firstBlock = JSON.stringify(getGenesisBlock());
  if (currentBlock !== firstBlock) {
    return false;
  }
  const tempBlocks = [blockchainToValidate[0]];
  for (var i = 1; i < blockchainToValidate.length; i++) {
    if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
      tempBlocks.push(blockchainToValidate[i]);
    } else {
      return false;
    }
  }
  return true;
};

const getLatestBlock = () => blockchain[blockchain.length - 1];
const queryChainLengthMsg = () => ({ 'type': MessageType.QUERY_LATEST });
const queryAllMsg = () => ({ 'type': MessageType.QUERY_ALL });
const responseChainMsg = () => ({
  'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});
const responseLatestMsg = (): Message => ({
  type: MessageType.RESPONSE_BLOCKCHAIN,
  data: JSON.stringify([getLatestBlock()])
});

const write =
  (ws: WebSocket, message: Message) => ws.send(JSON.stringify(message));
const broadcast =
  (message: Message) => sockets.forEach(socket => write(socket, message));
