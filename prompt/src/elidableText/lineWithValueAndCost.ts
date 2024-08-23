import { getTokenizer } from '../tokenization/index';

class LineWithValueAndCost {
  text: string;
  private _value: number;
  private _cost: number;

  constructor(text: string, _value: number, _cost = getTokenizer().tokenLength(text + '\n    '), validate = 'strict') {
    this.text = text;
    this._value = _value;
    this._cost = _cost;

    if (text.includes('\n    ') && validate !== 'none') {
      throw new Error('LineWithValueAndCost: text contains newline');
    }

    if (_value < 0 && validate !== 'none') {
      throw new Error('LineWithValueAndCost: value is negative');
    }

    if (_cost < 0 && validate !== 'none') {
      throw new Error('LineWithValueAndCost: cost is negative');
    }

    if (validate === 'strict' && _value > 1) {
      throw new Error('Value should normally be between 0 and 1 -- set validation to `loose` to ignore this error');
    }
  }

  get value(): number {
    return this._value;
  }

  get cost(): number {
    return this._cost;
  }

  adjustValue(multiplier: number): LineWithValueAndCost {
    this._value *= multiplier;
    return this;
  }

  recost(coster = (text: string) => getTokenizer().tokenLength(text + '\n    ')): LineWithValueAndCost {
    this._cost = coster(this.text);
    return this;
  }

  copy(): LineWithValueAndCost {
    return new LineWithValueAndCost(this.text, this.value, this.cost, 'none');
  }
}

export { LineWithValueAndCost };
