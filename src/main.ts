import {
  connectToPeers,
  initHttpServer,
  initP2PServer,
  initialPeers
} from "./naivechain";

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
