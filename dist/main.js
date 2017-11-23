"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var naivechain_1 = require("./naivechain");
naivechain_1.connectToPeers(naivechain_1.initialPeers);
naivechain_1.initHttpServer();
naivechain_1.initP2PServer();
