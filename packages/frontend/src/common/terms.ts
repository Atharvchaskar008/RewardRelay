import { keccak256, toBytes, type Hex } from "viem";
import { buildListingTerms, canonicalJson, type ListingTerms } from "rewardrelay-shared";

/**
 * keccak256 of the canonical listing terms: the `termsHash` the sharer commits to in createListing
 * and the server re-checks before publishing the listing. Used by both the server and the client SDK.
 */
export function listingTermsHash(input: Omit<ListingTerms, "version">): Hex {
  return keccak256(toBytes(canonicalJson(buildListingTerms(input))));
}
