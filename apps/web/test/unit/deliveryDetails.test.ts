import { describe, expect, it } from "vitest";
import { deliveryDetailsProblem, deliveryDetailsSchema } from "@/common/deliveryDetails";

const valid = {
  name: "Rahul Test",
  phone: "+919000000003",
  addressLines: ["Flat 101, Test Residency", "MG Road, Pune"],
  pincode: "411005",
};

describe("delivery details", () => {
  it("accepts complete details and trims what people paste", () => {
    expect(deliveryDetailsProblem(valid)).toBeUndefined();
    const parsed = deliveryDetailsSchema.parse({
      ...valid,
      name: " Rahul Test ",
      pincode: " 411005 ",
    });
    expect(parsed).toMatchObject({ name: "Rahul Test", pincode: "411005" });
  });

  it("names the first missing or invalid field in plain words", () => {
    expect(deliveryDetailsProblem(undefined)).toBe("Enter the delivery address first.");
    expect(deliveryDetailsProblem({ ...valid, name: "" })).toBe(
      "Enter the full name for delivery.",
    );
    expect(deliveryDetailsProblem({ ...valid, phone: "12345" })).toBe(
      "Enter a valid mobile number for delivery.",
    );
    expect(deliveryDetailsProblem({ ...valid, addressLines: [] })).toBe(
      "Enter the delivery address.",
    );
    expect(deliveryDetailsProblem({ ...valid, addressLines: ["  "] })).toBe(
      "Remove the empty address line.",
    );
    expect(deliveryDetailsProblem({ ...valid, pincode: "41100" })).toBe(
      "Enter a 6-digit PIN code.",
    );
  });

  it("rejects unexpected fields", () => {
    expect(deliveryDetailsProblem({ ...valid, cardNumber: "4111" })).toBeDefined();
  });
});
