import { Checkbox, PasswordInput, Switch } from "@mantine/core";
import { ResponseModifications } from "../../types/general/ResponseModifications";
import { User } from '../../types/users/User';
import dayjs from 'dayjs';
import { IconEyeCheck, IconEyeOff } from "@tabler/icons-react";
import React from "react";
import CustomEditSwitch from "../../utils/CustomEditSwitch";

export const usersColumnDef: ResponseModifications<Partial<User>>[] = [
  {
    accessorKey: 'id',
    modifications: {
      id: 'id',
      header: 'ID',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
      visibleInShowHideMenu: false,
    }
  },
  {
    accessorKey: 'username',
    modifications: {
      id: 'username',
      header: 'Username',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'firstName',
    modifications: {
      id: 'firstName',
      header: 'First Name',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'lastName',
    modifications: {
      id: 'lastName',
      header: 'Last Name',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'email',
    modifications: {
      enableClickToCopy: true,
      id: 'email',
      header: 'Email',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      mantineEditTextInputProps: {
        type: 'email',
        required: true,
      },
    }
  },
  {
    accessorKey: 'password',
    modifications: {
      id: 'password',
      header: 'Password',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => <PasswordInput
        disabled
        style={{ width: '100%', border: '0px' }}
        defaultValue={cell.getValue<string>()}
        visibilityToggleIcon={({ reveal }) =>
          reveal ? (
            <IconEyeOff style={{ width: 'var(--psi-icon-size)', height: 'var(--psi-icon-size)' }} />
          ) : (
            <IconEyeCheck style={{ width: 'var(--psi-icon-size)', height: 'var(--psi-icon-size)' }} />
          )
        }
      />,
      mantineEditTextInputProps: {
        required: true,
      },
    }
  },
  {
    accessorKey: 'createdAt',
    modifications: {
      id: 'createdAt',
      header: 'Created Date',
      filterVariant: 'date-range',
      sortingFn: 'datetime',
      enableColumnFilterModes: false,
      Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'updatedAt',
    modifications: {
      id: 'updatedAt',
      header: 'Updated Date',
      filterVariant: 'date-range',
      sortingFn: 'datetime',
      enableColumnFilterModes: false,
      Cell: ({ cell }) => dayjs(cell.getValue<Date>()).format('YYYY-MM-DD HH:mm:ss'),
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'createdBy',
    modifications: {
      id: 'createdBy',
      header: 'Created By',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'updatedBy',
    modifications: {
      id: 'updatedBy',
      header: 'Updated By',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Edit: () => null,
    }
  },
  {
    accessorKey: 'status',
    modifications: {
      id: 'status',
      header: 'Status',
      Header: ({ column }) => <div>{column.columnDef.header}</div>,
      Cell: ({ cell }) => <Switch
                            checked={Boolean(cell.getValue<boolean>())}
                            onLabel="ON" 
                            offLabel="OFF"
                            />,
      Edit: ({ cell, row, table }) => <CustomEditSwitch cell={cell} row={row} table={table} />
    }
  },
];