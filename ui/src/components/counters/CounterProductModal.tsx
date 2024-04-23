import React from 'react';
import { CounterProductModalProps } from '../../types/counterProducts/CounterProductModalProps';
import CreationModeContent from './CreationModeContent';
import EditionModeContent from './EditionModeContent';

const CounterProductModal: React.FC<CounterProductModalProps> = ({ table, row }) => {

  return (
    <>
      {table.getState().creatingRow ? (
        // Creation mode JSX elements
        <CreationModeContent table={table} row={row} />
      ) : (
        // Edition mode JSX elements
        <EditionModeContent table={table} row={row}/>
      )}
    </>
  );
};

export default CounterProductModal;
