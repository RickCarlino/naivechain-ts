"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var naivechain_1 = require("../naivechain");
describe("Block", function () {
    it("initializes", function () {
        var block = new naivechain_1.Block(0, "0", 1465154705, "my genesis block!!", "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
        expect(block.index).toEqual(0);
        expect(block.previousHash).toEqual("0");
        expect(block.timestamp).toEqual(1465154705);
        expect(block.data).toEqual("my genesis block!!");
        expect(block.hash)
            .toEqual("816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
    });
});
describe("isValidChain", function () {
    it("Validates an empty chain", function () {
    });
});
describe("getGenesisBlock", function () {
    it("needs tests");
});
describe("getLatestBlock", function () {
    it("needs tests");
});
describe("handleBlockchainResponse", function () {
    it("needs tests");
});
