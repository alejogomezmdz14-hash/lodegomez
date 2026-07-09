import { describe, it, expect } from "vitest";
import { validarCuit } from "./cuit";

describe("validarCuit", () => {
  it("acepta un CUIT válido (con y sin guiones)", () => {
    expect(validarCuit("27288869990")).toBe(true);
    expect(validarCuit("27-28886999-0")).toBe(true);
  });
  it("rechaza dígito verificador incorrecto", () => {
    expect(validarCuit("27288869991")).toBe(false);
  });
  it("rechaza longitud incorrecta o no numérico", () => {
    expect(validarCuit("123")).toBe(false);
    expect(validarCuit("abcdefghijk")).toBe(false);
  });
});
