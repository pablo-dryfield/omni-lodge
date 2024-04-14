import { Center, Title } from '@mantine/core';
import ProductsList from '../components/products/ProductsList';
import { GenericPageProps } from '../types/general/GenericPageProps';
import { useAppDispatch } from '../store/hooks';
import { navigateToPage } from '../actions/navigationActions';
import { useEffect } from 'react';

const Products = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);
  return (
    <div>
      <Center>
        <Title order={2}>{props.title}</Title>
      </Center>
      <ProductsList />
    </div>
  );
};

export default Products;
