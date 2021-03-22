import { ActionTree, GetterTree, MutationTree } from "vuex";
import { walletData } from "@/plugins/walletData";
import { ETHOperation, DepositsInterface, ActiveDepositInterface } from "@/plugins/types";
import { BigNumber } from "ethers";
import { RootState } from "~/store";

interface depositsInterface {
  [tokenSymbol: string]: Array<{
    hash: string;
    amount: string;
    status: string;
    confirmations: number;
  }>;
}

export const state = () => ({
  watchedTransactions: {} as {
    [txHash: string]: {
      [prop: string]: string;
      status: string;
    };
  },
  deposits: {} as depositsInterface,
  forceUpdateTick: 0,
  withdrawalTxToEthTx: new Map() as Map<string, string>,
});

export type TransactionModuleState = ReturnType<typeof state>;

export const mutations: MutationTree<TransactionModuleState> = {
  updateTransactionStatus(state, { hash, status }): void {
    if (status === "Verified") {
      delete state.watchedTransactions[hash];
      return;
    }
    if (!state.watchedTransactions.hasOwnProperty(hash)) {
      state.watchedTransactions[hash] = {
        status,
      };
    } else {
      state.watchedTransactions[hash].status = status;
    }
  },
  updateDepositStatus(state, { tokenSymbol, hash, amount, status, confirmations }) {
    if (!Array.isArray(state.deposits[tokenSymbol])) {
      state.deposits[tokenSymbol] = [];
    }
    let txIndex = -1;
    for (let a = 0; a < state.deposits[tokenSymbol].length; a++) {
      if (state.deposits[tokenSymbol][a].hash === hash) {
        txIndex = a;
        break;
      }
    }
    if (txIndex === -1) {
      state.deposits[tokenSymbol].push({
        hash,
        amount,
        status,
        confirmations,
      });
      state.forceUpdateTick++;
    } else {
      state.deposits[tokenSymbol][txIndex].status = status;
      state.forceUpdateTick++;
    }
  },
  setWithdrawalTx(state, { tx, ethTx }) {
    state.withdrawalTxToEthTx.set(tx, ethTx);
  },
};

export const getters: GetterTree<TransactionModuleState, RootState> = {
  depositList(state) {
    state.forceUpdateTick;
    return state.deposits;
  },
  getWithdrawalTx(state) {
    return (tx: string): string | undefined => {
      return state.withdrawalTxToEthTx.get(tx);
    };
  },
  getActiveDeposits(state, getters): ActiveDepositInterface {
    const deposits = getters.depositList as DepositsInterface;
    const activeDeposits = {} as DepositsInterface;
    const finalDeposits = {} as {
      [tokenSymbol: string]: BigNumber;
    };
    for (const tokenSymbol in deposits) {
      activeDeposits.tokenSymbol = deposits.tokenSymbol.filter((tx) => tx.status === "Initiated");
    }
    for (const tokenSymbol in activeDeposits) {
      if (activeDeposits?.tokenSymbol.length > 0) {
        if (!finalDeposits?.tokenSymbol) {
          finalDeposits.tokenSymbol = BigNumber.from("0");
        }
        for (const tx of activeDeposits.tokenSymbol) {
          finalDeposits.tokenSymbol = finalDeposits.tokenSymbol.add(tx.amount);
        }
      }
    }
    return finalDeposits;
  },
};

export const actions: ActionTree<TransactionModuleState, RootState> = {
  async watchTransaction({ dispatch, commit, state }, { transactionHash, existingTransaction /* , tokenSymbol, type */ }): Promise<void> {
    try {
      if (state.watchedTransactions.hasOwnProperty(transactionHash)) {
        return;
      }
      if (!existingTransaction) {
        await walletData.get().syncProvider!.notifyTransaction(transactionHash, "COMMIT");
        commit("updateTransactionStatus", { hash: transactionHash, status: "Commited" });
        dispatch("requestBalancesUpdate");
      } else {
        commit("updateTransactionStatus", { hash: transactionHash, status: "Commited" });
      }
      await walletData.get().syncProvider!.notifyTransaction(transactionHash, "VERIFY");
      commit("updateTransactionStatus", { hash: transactionHash, status: "Verified" });
      dispatch("requestBalancesUpdate");
    } catch (error) {
      commit("updateTransactionStatus", { hash: transactionHash, status: "Verified" });
    }
  },
  async watchDeposit({ dispatch, commit }, { depositTx, tokenSymbol, amount }: { depositTx: ETHOperation; tokenSymbol: string; amount: string }): Promise<void> {
    try {
      commit("updateDepositStatus", { hash: depositTx!.ethTx.hash, tokenSymbol, amount, status: "Initiated", confirmations: 1 });
      await depositTx.awaitEthereumTxCommit();
      dispatch("requestBalancesUpdate");
      // commit('updateDepositStatus', {hash: depositTx!.ethTx.hash, tokenSymbol, amount, status: 'Initiated', confirmations: commitedDeposit.confirmations});
      await depositTx.awaitReceipt();
      dispatch("requestBalancesUpdate");
      commit("updateDepositStatus", { hash: depositTx!.ethTx.hash, tokenSymbol, status: "Commited" });
      const depositVerifyReceipt = await depositTx.awaitVerifyReceipt();
      dispatch("requestBalancesUpdate");
      commit("updateDepositStatus", { hash: depositTx!.ethTx.hash, tokenSymbol, status: "Verified" });
    } catch (error) {
      commit("updateDepositStatus", { hash: depositTx!.ethTx.hash, tokenSymbol, status: "Verified" });
    }
  },
  async requestBalancesUpdate(): Promise<void> {
    this.dispatch("wallet/getzkBalances", { accountState: undefined, force: true });
    /* this.dispatch("wallet/getTransactionsHistory", { offset: 0, force: true }); */
  },
};
