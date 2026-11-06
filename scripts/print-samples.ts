/**
 * Prints two example unsigned transactions (base64) for manual testing of the
 * paste box: an S1-like normal SOL payment and an S2-like unlimited token
 * approval. They are built offline with fixed example addresses and a fixed
 * blockhash; nothing is signed or sent (the app only simulates them). Run: npm run samples:print
 */
import { buildTxBase64, solPaymentIx, unlimitedApproveIx } from "../tests/helpers/build-tx";

const samples = {
  "S1-like normal payment (0.01 SOL)": buildTxBase64([solPaymentIx()]),
  "S2-like unlimited token approval": buildTxBase64([unlimitedApproveIx()]),
};

for (const [name, base64] of Object.entries(samples)) {
  console.log(`${name}:\n${base64}\n`);
}
