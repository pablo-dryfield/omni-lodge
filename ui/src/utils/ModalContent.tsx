import { Box, Flex, Grid, Modal, ScrollArea } from "@mantine/core";
import { MRT_EditActionButtons } from "mantine-react-table";
import { useEffect } from "react";
import { ModalContentProps } from "../types/general/ModalContentProps";

export const ModalContent = <T extends {}>({
    internalEditComponents,
    row,
    table,
    opened,
    setOpened,
    title,
}: ModalContentProps<T>) => {
    useEffect(() => {
        if (table.getState().creatingRow || table.getState().editingRow) {
            setOpened(true);
        }
    }, [table, setOpened]);
  
    const handleClose = () => {
        setOpened(false);
        table.setCreatingRow(null);
        table.setEditingRow(null);
    };
    const splitIndex = Math.ceil(internalEditComponents.length / 2);
    return (
      <Modal
        opened={opened}
        onClose={handleClose}
        centered
        closeOnEscape 
        closeOnClickOutside 
        title={<div style={{ fontWeight: 'bold', fontSize: '1.25em' }}>{title}</div>}
        scrollAreaComponent={ScrollArea.Autosize}
        transitionProps={{ transition: 'rotate-left', duration: 200 }}
        size="40%"
        overlayProps={{
          backgroundOpacity: 0.55,
          blur: 3,
        }}
      >
        <Box style={{ maxHeight: '80vh' }}>
          <Grid>
            <Grid.Col span={6} style={{ padding: '8px 16px' }}>
              {internalEditComponents.slice(0, splitIndex).map((field, index) => (
                <div key={index} style={{ marginBottom: '15px' }}>{field}</div>
              ))}
            </Grid.Col>
            <Grid.Col span={6} style={{ padding: '8px 16px' }}>
              {internalEditComponents.slice(splitIndex).map((field, index) => (
                <div key={index} style={{ marginBottom: '15px' }}>{field}</div>
              ))}
            </Grid.Col>
          </Grid>
          <Flex justify="flex-end">
            <MRT_EditActionButtons row={row} table={table} variant="text" />
          </Flex>
        </Box>
      </Modal>
    );
  };