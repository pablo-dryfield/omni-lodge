import {
    type ServerResponse,
  } from './ServerResponse';

export type DataState<T extends Record<string, any>> = [{
    loading: boolean;
    data: ServerResponse<T>; 
    error: string | null;
}];