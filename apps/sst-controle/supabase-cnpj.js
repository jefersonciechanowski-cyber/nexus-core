(() => {
  'use strict';

  function raw(value) { return String(value || ''); }

  function hasAllowedInputChars(value) {
    return /^[A-Za-z0-9./\-\s]*$/.test(raw(value));
  }

  function normalize(value) {
    return raw(value).toUpperCase().replace(/[./\-\s]/g, '');
  }

  function format(value) {
    if (!hasAllowedInputChars(value)) return raw(value).toUpperCase();
    const cnpj = normalize(value);
    if (cnpj.length > 14) return raw(value).toUpperCase();
    const parts = [cnpj.slice(0, 2), cnpj.slice(2, 5), cnpj.slice(5, 8), cnpj.slice(8, 12), cnpj.slice(12, 14)];
    let result = parts[0];
    if (parts[1]) result += `.${parts[1]}`;
    if (parts[2]) result += `.${parts[2]}`;
    if (parts[3]) result += `/${parts[3]}`;
    if (parts[4]) result += `-${parts[4]}`;
    return result;
  }

  function characterValue(character) { return character.charCodeAt(0) - 48; }

  function checkDigit(value, weights) {
    const sum = value.split('').reduce((total, character, index) => total + characterValue(character) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  }

  function isValid(value) {
    if (!hasAllowedInputChars(value)) return false;
    const cnpj = normalize(value);
    if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) return false;
    const first = checkDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = checkDigit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return first === Number(cnpj[12]) && second === Number(cnpj[13]);
  }

  window.NexusCnpj = { hasAllowedInputChars, normalize, format, isValid };
})();
