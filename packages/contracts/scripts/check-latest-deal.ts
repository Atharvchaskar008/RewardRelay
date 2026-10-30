import { ethers } from "hardhat";

async function main() {
  const escrow = await ethers.getContractAt(
    "RelayEscrow",
    "0xE13c653b082E8243eD0ceE972463a949AB2743a7",
  );
  const sbt = await ethers.getContractAt(
    "ReputationSBT",
    "0x8dcF8EB4F893b415BD32c6Aab44cbecD49A4690e",
  );

  const count = await escrow.dealCount();
  console.log("Total deals on chain:", count.toString());

  const sharer = "0x3Ee033Fc4eDe88bca3c1d525eEF0D01CF4099eAC";
  const seeker = "0x820A3a10239C7c480491b96e7b5232d158BB19C1";

  const [sharerBal, seekerBal] = await Promise.all([
    ethers.provider.getBalance(sharer),
    ethers.provider.getBalance(seeker),
  ]);

  console.log("Sharer (Laptop) balance:", ethers.formatEther(sharerBal), "MSTC");
  console.log("Seeker (Phone) balance:", ethers.formatEther(seekerBal), "MSTC");

  const [sharerLimit, seekerLimit] = await Promise.all([
    sbt.maxDealValue(sharer),
    sbt.maxDealValue(seeker),
  ]);
  console.log("Sharer maxDealValue:", ethers.formatEther(sharerLimit), "MSTC");
  console.log("Seeker maxDealValue:", ethers.formatEther(seekerLimit), "MSTC");

  const statusNames = [
    "Listed",
    "Locked",
    "Delivered",
    "Disputed",
    "Completed",
    "Resolved",
    "Refunded",
    "Cancelled",
  ];

  for (let i = 1n; i <= count; i++) {
    const d = await escrow.getDeal(i);
    const now = Math.floor(Date.now() / 1000);
    console.log(`--- Deal #${i} ---`);
    console.log("Status:", statusNames[Number(d.status)] || d.status);
    console.log("Sharer:", d.sharer);
    console.log("Seeker:", d.seeker);
    console.log("Price:", ethers.formatEther(d.price), "MSTC");
    console.log("SharerDeposit:", ethers.formatEther(d.sharerDeposit), "MSTC");
    console.log("SeekerDeposit:", ethers.formatEther(d.seekerDeposit), "MSTC");
    console.log(
      "DeliverBy:",
      d.deliverBy.toString(),
      "(now:",
      now,
      "diff:",
      Number(d.deliverBy) - now,
      "s)",
    );
    console.log("TermsHash:", d.termsHash);
    console.log("Category:", d.category.toString());
  }
}

main().catch(console.error);
