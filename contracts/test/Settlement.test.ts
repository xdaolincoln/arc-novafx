import { expect } from "chai";
import { ethers } from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { Settlement } from "../typechain-types";

// Arc Testnet token addresses
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

// Settlement contract address - will be set after deployment
let SETTLEMENT_CONTRACT_ADDRESS: string;

// ERC20 ABI (minimal for transfer functions)
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function transferFrom(address, address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

describe("Settlement Contract", function () {
  let settlement: Settlement;
  let usdc: any; // ERC20 contract
  let eurc: any; // ERC20 contract
  let owner: any;
  let taker: any;
  let maker: any;

  // Using 6 decimals (USDC/EURC standard)
  const FROM_AMOUNT = ethers.parseUnits("1", 6); // 1 USDC
  const TO_AMOUNT = ethers.parseUnits("0.92", 6); // 0.92 EURC

  // Deploy new contract before all tests
  before(async function () {
    const signers = await ethers.getSigners();
    
    if (signers.length === 0) {
      throw new Error("No signers found. Please set PRIVATE_KEY in .env file");
    }

    owner = signers[0];
    
    // Deploy new Settlement contract for this test run
    const SettlementFactory = await ethers.getContractFactory("Settlement");
    const settlementContract = await SettlementFactory.deploy(
      "Arc FX Settlement",  // EIP712 name
      "1",                   // EIP712 version
      owner.address          // initialOwner
    );
    await settlementContract.waitForDeployment();
    
    SETTLEMENT_CONTRACT_ADDRESS = await settlementContract.getAddress();
    console.log(`📦 Deployed new Settlement contract: ${SETTLEMENT_CONTRACT_ADDRESS}`);
  });

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    
    if (signers.length === 0) {
      throw new Error("No signers found. Please set PRIVATE_KEY in .env file");
    }

    // Use first signer as owner, taker, maker (hoặc có thể dùng nhiều accounts nếu có)
    owner = signers[0];
    taker = signers.length > 1 ? signers[1] : signers[0];
    maker = signers.length > 2 ? signers[2] : signers[0];

    // Connect to real USDC/EURC contracts on Arc testnet
    usdc = await ethers.getContractAt(ERC20_ABI, USDC_ADDRESS);
    eurc = await ethers.getContractAt(ERC20_ABI, EURC_ADDRESS);

    // Connect to newly deployed Settlement contract
    const SettlementFactory = await ethers.getContractFactory("Settlement");
    settlement = await SettlementFactory.attach(SETTLEMENT_CONTRACT_ADDRESS) as Settlement;

    // Approve settlement contract to spend tokens
    // Note: Assumes test accounts already have USDC/EURC from faucet
    try {
      await usdc.connect(taker).approve(SETTLEMENT_CONTRACT_ADDRESS, ethers.MaxUint256);
      await eurc.connect(maker).approve(SETTLEMENT_CONTRACT_ADDRESS, ethers.MaxUint256);
    } catch (error) {
      console.warn("Warning: Could not approve tokens. Make sure accounts have tokens and allowance.");
    }
  });

  describe("Deployment", function () {
    it("Should connect to deployed contract", async function () {
      const address = await settlement.getAddress();
      expect(address.toLowerCase()).to.equal(SETTLEMENT_CONTRACT_ADDRESS.toLowerCase());
    });

    it("Should read trade counter from deployed contract", async function () {
      const counter = await settlement.tradeCounter();
      expect(counter).to.be.a("bigint");
      // Counter có thể > 0 nếu đã có trades trước đó
    });

    it("Should connect to real USDC contract", async function () {
      expect(USDC_ADDRESS).to.match(/^0x[a-fA-F0-9]{40}$/);
      // Verify we can read balance (proves contract exists)
      const balance = await usdc.balanceOf(taker.address);
      expect(balance).to.be.a("bigint");
    });

    it("Should connect to real EURC contract", async function () {
      expect(EURC_ADDRESS).to.match(/^0x[a-fA-F0-9]{40}$/);
      // Verify we can read balance (proves contract exists)
      const balance = await eurc.balanceOf(maker.address);
      expect(balance).to.be.a("bigint");
    });
  });

  describe("createTrade", function () {
    it("Should create a new trade", async function () {
      const settlementTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      
      // Get current trade counter before creating trade
      const currentCounter = await settlement.tradeCounter();
      const expectedTradeId = currentCounter;

      const tx = await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );

      const receipt = await tx.wait();
      await expect(receipt)
        .to.emit(settlement, "TradeCreated")
        .withArgs(expectedTradeId, taker.address, maker.address);

      const trade = await settlement.trades(expectedTradeId);
      expect(trade.taker).to.equal(taker.address);
      expect(trade.maker).to.equal(maker.address);
      expect(trade.fromToken.toLowerCase()).to.equal(USDC_ADDRESS.toLowerCase());
      expect(trade.toToken.toLowerCase()).to.equal(EURC_ADDRESS.toLowerCase());
      expect(trade.fromAmount).to.equal(FROM_AMOUNT);
      expect(trade.toAmount).to.equal(TO_AMOUNT);
      expect(trade.settlementTime).to.equal(settlementTime);
      expect(trade.takerFunded).to.be.false;
      expect(trade.makerFunded).to.be.false;
      expect(trade.settled).to.be.false;
    });

    it("Should increment trade counter", async function () {
      const settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const initialCounter = await settlement.tradeCounter();

      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );

      const counterAfterFirst = await settlement.tradeCounter();
      expect(counterAfterFirst).to.equal(initialCounter + 1n);

      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );

      const counterAfterSecond = await settlement.tradeCounter();
      expect(counterAfterSecond).to.equal(counterAfterFirst + 1n);
    });
  });

  describe("fundTrade", function () {
    let tradeId: bigint;
    let settlementTime: number;

    beforeEach(async function () {
      settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const counterBefore = await settlement.tradeCounter();
      const tx = await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );
      await tx.wait();
      tradeId = counterBefore; // Trade ID is the counter value before creation
    });

    it("Should allow taker to fund trade", async function () {
      const tx = await settlement.connect(taker).fundTrade(tradeId);
      const receipt = await tx.wait();

      await expect(receipt)
        .to.emit(settlement, "TradeFunded")
        .withArgs(tradeId, taker.address, USDC_ADDRESS, FROM_AMOUNT);

      const trade = await settlement.trades(tradeId);
      expect(trade.takerFunded).to.be.true;
      expect(await settlement.escrowBalances(tradeId, USDC_ADDRESS)).to.equal(FROM_AMOUNT);
    });

    it("Should transfer tokens from taker to contract", async function () {
      // Create a new trade for this test to avoid conflicts
      const settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const counterBefore = await settlement.tradeCounter();
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );
      const newTradeId = counterBefore;

      const takerBalanceBefore = await usdc.balanceOf(taker.address);
      const contractBalanceBefore = await usdc.balanceOf(SETTLEMENT_CONTRACT_ADDRESS);

      await settlement.connect(taker).fundTrade(newTradeId);

      const takerBalanceAfter = await usdc.balanceOf(taker.address);
      const contractBalanceAfter = await usdc.balanceOf(SETTLEMENT_CONTRACT_ADDRESS);

      expect(takerBalanceBefore - takerBalanceAfter).to.equal(FROM_AMOUNT);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(FROM_AMOUNT);
    });

    it("Should revert if not called by taker", async function () {
      // Skip if taker and maker are the same address
      if (taker.address.toLowerCase() === maker.address.toLowerCase()) {
        this.skip();
      }
      await expect(settlement.connect(maker).fundTrade(tradeId)).to.be.revertedWith(
        "Only taker can fund"
      );
    });

    it("Should revert if already funded", async function () {
      // Create a new trade for this test to avoid conflicts
      const settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const counterBefore = await settlement.tradeCounter();
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );
      const newTradeId = counterBefore;

      // Fund first time
      await settlement.connect(taker).fundTrade(newTradeId);
      
      // Try to fund again - should revert
      await expect(settlement.connect(taker).fundTrade(newTradeId)).to.be.revertedWith("Already funded");
    });

    it("Should revert if settlement time passed", async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const counterBefore = await settlement.tradeCounter();
      // Use owner to create trade (anyone can create trade)
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        pastTime
      );

      // Now taker tries to fund - should revert with "Settlement time passed"
      // Note: Contract checks "Only taker can fund" first, then "Settlement time passed"
      // So we need to ensure taker.address matches the trade.taker
      await expect(settlement.connect(taker).fundTrade(counterBefore)).to.be.revertedWith(
        "Settlement time passed"
      );
    });
  });

  describe("makerFund", function () {
    let tradeId: bigint;
    let settlementTime: number;

    beforeEach(async function () {
      settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const counterBefore = await settlement.tradeCounter();
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );
      tradeId = counterBefore;
    });

    it("Should allow maker to fund trade", async function () {
      // Check if trade is already funded (from previous test)
      const trade = await settlement.trades(tradeId);
      if (trade.makerFunded) {
        this.skip(); // Skip if already funded
      }

      const tx = await settlement.connect(maker).makerFund(tradeId);
      const receipt = await tx.wait();

      await expect(receipt)
        .to.emit(settlement, "TradeFunded")
        .withArgs(tradeId, maker.address, EURC_ADDRESS, TO_AMOUNT);

      const tradeAfter = await settlement.trades(tradeId);
      expect(tradeAfter.makerFunded).to.be.true;
      expect(await settlement.escrowBalances(tradeId, EURC_ADDRESS)).to.equal(TO_AMOUNT);
    });

    it("Should transfer tokens from maker to contract", async function () {
      // Check if trade is already funded (from previous test)
      const trade = await settlement.trades(tradeId);
      if (trade.makerFunded) {
        this.skip(); // Skip if already funded
      }

      const makerBalanceBefore = await eurc.balanceOf(maker.address);
      const contractBalanceBefore = await eurc.balanceOf(SETTLEMENT_CONTRACT_ADDRESS);

      await settlement.connect(maker).makerFund(tradeId);

      const makerBalanceAfter = await eurc.balanceOf(maker.address);
      const contractBalanceAfter = await eurc.balanceOf(SETTLEMENT_CONTRACT_ADDRESS);

      expect(makerBalanceBefore - makerBalanceAfter).to.equal(TO_AMOUNT);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(TO_AMOUNT);
    });

    it("Should revert if not called by maker", async function () {
      // Skip if taker and maker are the same address
      if (taker.address.toLowerCase() === maker.address.toLowerCase()) {
        this.skip();
      }
      await expect(settlement.connect(taker).makerFund(tradeId)).to.be.revertedWith(
        "Only maker can fund"
      );
    });

    it("Should revert if already funded", async function () {
      // Create a new trade for this test to avoid conflicts
      const settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const counterBefore = await settlement.tradeCounter();
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );
      const newTradeId = counterBefore;

      // Fund first time
      await settlement.connect(maker).makerFund(newTradeId);
      
      // Try to fund again - should revert
      await expect(settlement.connect(maker).makerFund(newTradeId)).to.be.revertedWith("Already funded");
    });
  });

  describe("settle", function () {
    let tradeId: bigint;
    let settlementTime: number;

    beforeEach(async function () {
      settlementTime = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
      const counterBefore = await settlement.tradeCounter();
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        settlementTime
      );

      tradeId = counterBefore;

      // Fund both parties
      // Note: If taker = maker (same address), both calls will work because
      // contract checks trade.taker == msg.sender and trade.maker == msg.sender separately
      // Both checks will pass because taker.address == maker.address
      const tradeBefore = await settlement.trades(tradeId);
      if (!tradeBefore.takerFunded) {
        try {
          await settlement.connect(taker).fundTrade(tradeId);
        } catch (error: any) {
          // Skip if insufficient balance
          if (error.message?.includes('transfer amount exceeds balance')) {
            this.skip();
          }
          throw error;
        }
      }
      if (!tradeBefore.makerFunded) {
        try {
          await settlement.connect(maker).makerFund(tradeId);
        } catch (error: any) {
          // Skip if insufficient balance
          if (error.message?.includes('transfer amount exceeds balance')) {
            this.skip();
          }
          throw error;
        }
      }
    });

    it("Should settle trade after settlement time", async function () {
      // Note: evm_increaseTime only works on local Hardhat node, not on Arc testnet
      // On testnet, we need to wait for real time or use a trade with past settlement time
      // For now, skip this test on testnet or use a trade created with past time
      try {
        await ethers.provider.send("evm_increaseTime", [600]); // 10 minutes
        await ethers.provider.send("evm_mine", []);
      } catch (error) {
        // Method not available on Arc testnet, skip test
        this.skip();
        return;
      }

      const takerBalanceBefore = await eurc.balanceOf(taker.address);
      const makerBalanceBefore = await usdc.balanceOf(maker.address);

      const tx = await settlement.settle(tradeId);
      const receipt = await tx.wait();

      await expect(receipt).to.emit(settlement, "TradeSettled").withArgs(tradeId);

      const trade = await settlement.trades(tradeId);
      expect(trade.settled).to.be.true;

      // Check token transfers
      const takerBalanceAfter = await eurc.balanceOf(taker.address);
      const makerBalanceAfter = await usdc.balanceOf(maker.address);

      expect(takerBalanceAfter - takerBalanceBefore).to.equal(TO_AMOUNT);
      expect(makerBalanceAfter - makerBalanceBefore).to.equal(FROM_AMOUNT);
    });

    it("Should revert if not both parties funded", async function () {
      // Create new trade without funding
      const newSettlementTime = Math.floor(Date.now() / 1000) + 3600;
      const counterBefore = await settlement.tradeCounter();
      await settlement.createTrade(
        taker.address,
        maker.address,
        USDC_ADDRESS,
        EURC_ADDRESS,
        FROM_AMOUNT,
        TO_AMOUNT,
        newSettlementTime
      );

      try {
        await ethers.provider.send("evm_increaseTime", [4000]);
        await ethers.provider.send("evm_mine", []);
      } catch (error) {
        // Method not available on Arc testnet, skip test
        this.skip();
        return;
      }

      await expect(settlement.settle(counterBefore)).to.be.revertedWith("Both parties must fund");
    });

    it("Should revert if settlement time not reached", async function () {
      // Check if trade is funded (from beforeEach)
      const trade = await settlement.trades(tradeId);
      if (!trade.takerFunded || !trade.makerFunded) {
        this.skip(); // Skip if not fully funded
      }
      
      await expect(settlement.settle(tradeId)).to.be.revertedWith("Settlement time not reached");
    });

    it("Should revert if already settled", async function () {
      try {
        await ethers.provider.send("evm_increaseTime", [600]);
        await ethers.provider.send("evm_mine", []);
      } catch (error) {
        // Method not available on Arc testnet, skip test
        this.skip();
        return;
      }

      await settlement.settle(tradeId);
      await expect(settlement.settle(tradeId)).to.be.revertedWith("Already settled");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple trades correctly", async function () {
      const settlementTime = Math.floor(Date.now() / 1000) + 3600;
      const initialCounter = await settlement.tradeCounter();

      // Create 3 trades
      const tradeIds: bigint[] = [];
      let currentCounter = initialCounter;
      for (let i = 0; i < 3; i++) {
        const counterBefore = await settlement.tradeCounter();
        await settlement.createTrade(
          taker.address,
          maker.address,
          USDC_ADDRESS,
          EURC_ADDRESS,
          FROM_AMOUNT,
          TO_AMOUNT,
          settlementTime
        );
        tradeIds.push(counterBefore);
        currentCounter = await settlement.tradeCounter();
        expect(currentCounter).to.equal(counterBefore + 1n);
      }

      expect(await settlement.tradeCounter()).to.equal(initialCounter + 3n);

      // Fund first trade
      await settlement.connect(taker).fundTrade(tradeIds[0]);
      await settlement.connect(maker).makerFund(tradeIds[0]);

      const trade0 = await settlement.trades(tradeIds[0]);
      expect(trade0.takerFunded).to.be.true;
      expect(trade0.makerFunded).to.be.true;

      // Other trades should not be funded
      const trade1 = await settlement.trades(tradeIds[1]);
      expect(trade1.takerFunded).to.be.false;
      expect(trade1.makerFunded).to.be.false;
    });
  });
});

