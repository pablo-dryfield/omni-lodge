import { useMediaQuery } from "@mantine/hooks";
import { Box, Flex, Modal, ScrollArea, Grid } from "@mantine/core";
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
    action,
    custom,
}: ModalContentProps<T>) => {
    useEffect(() => {
        if (table.getState().creatingRow || table.getState().editingRow) {
            setOpened(true);
        }
    }, [table, setOpened]);

    const isMobile = useMediaQuery("(max-width: 768px)");

    const handleClose = () => {
        setOpened(false);
        table.setCreatingRow(null);
        table.setEditingRow(null);
    };

    const modalSize = isMobile ? "100%" : "40%";

    if (custom) {
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
                size={modalSize}
                overlayProps={{
                    backgroundOpacity: 0.55,
                    blur: 3,
                }}
            >
                <Box style={{ maxHeight: '80vh' }}>
                    {internalEditComponents}
                </Box>
            </Modal>
        );
    } else {
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
                size={modalSize}
                overlayProps={{
                    backgroundOpacity: 0.55,
                    blur: 3,
                }}
            >
                <Box style={{ maxHeight: '80vh' }}>
                    <Grid>
                        <Grid.Col span={6} style={{ padding: '8px 16px' }}>
                            {internalEditComponents.slice(0, splitIndex).map((field, index) => {
                                return <div key={index} style={{ marginBottom: '15px' }}>{field}</div>;
                            })}
                        </Grid.Col>
                        <Grid.Col span={6} style={{ padding: '8px 16px' }}>
                            {internalEditComponents.slice(splitIndex).map((field, index) => (
                                <div key={index} style={{ marginBottom: '15px' }}>{field}</div>
                            ))}
                        </Grid.Col>
                    </Grid>
                    <Flex justify="flex-end">
                        {/* eslint-disable-next-line react/jsx-pascal-case */}
                        <MRT_EditActionButtons row={row} table={table} variant="text" />
                    </Flex>
                </Box>
            </Modal>
        );
    }
};
