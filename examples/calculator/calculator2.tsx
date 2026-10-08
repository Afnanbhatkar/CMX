import React, { useState } from 'react';

const Calculator2 = () => {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const inputDot = () => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }

    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const clearDisplay = () => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setWaitingForOperand(false);
  };

  const performOperation = (nextOperation: string) => {
    const inputValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operation) {
      const currentValue = previousValue;
      let newValue: number;

      switch (operation) {
        case '+':
          newValue = currentValue + inputValue;
          break;
        case '-':
          newValue = currentValue - inputValue;
          break;
        case '×':
          newValue = currentValue * inputValue;
          break;
        case '÷':
          newValue = currentValue / inputValue;
          break;
        default:
          newValue = inputValue;
      }

      setDisplay(String(newValue));
      setPreviousValue(newValue);
    }

    setWaitingForOperand(true);
    setOperation(nextOperation);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-gray-800 p-6">
          <div className="text-right text-white text-4xl font-light h-16 overflow-x-auto whitespace-nowrap">
            {display}
          </div>
        </div>
        <div className="p-4 grid grid-cols-4 gap-3">
          <button 
            onClick={clearDisplay}
            className="col-span-2 bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-lg text-xl transition-colors"
          >
            C
          </button>
          <button 
            onClick={() => performOperation('÷')}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-lg text-xl transition-colors"
          >
            ÷
          </button>
          <button 
            onClick={() => performOperation('×')}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-lg text-xl transition-colors"
          >
            ×
          </button>
          
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0'].map((digit) => (
            <button
              key={digit}
              onClick={() => inputDigit(digit)}
              className="bg-gray-200 hover:bg-gray-300 font-bold py-4 rounded-lg text-xl transition-colors"
            >
              {digit}
            </button>
          ))}
          
          <button 
            onClick={inputDot}
            className="bg-gray-200 hover:bg-gray-300 font-bold py-4 rounded-lg text-xl transition-colors"
          >
            .
          </button>
          <button 
            onClick={() => performOperation('-')}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-lg text-xl transition-colors"
          >
            -
          </button>
          <button 
            onClick={() => performOperation('+')}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 rounded-lg text-xl transition-colors col-span-2"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
};

export default Calculator2;
