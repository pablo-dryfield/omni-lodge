import { useMediaQuery } from "@mantine/hooks";
import { Alert, Box, Flex, Modal, ScrollArea, Grid } from "@mantine/core";
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
    saveError,
    saving = false,
}: ModalContentProps<T>) => {
    useEffect(() => {
        if (table.getState().creatingRow || table.getState().editingRow) {
            setOpened(true);
        }
    }, [table, setOpened]);

    const isMobile = useMediaQuery("(max-width: 1024px)");

    const handleClose = () => {
        if (saving) return;
        setOpened(false);
        table.setCreatingRow(null);
        table.setEditingRow(null);
    };

    const modalSize = isMobile ? "100%" : "60%";

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
                    {saveError && <Alert color="red" title="Unable to save" mb="md">{saveError}</Alert>}
                    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                        {internalEditComponents}
                    </fieldset>
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
                    {saveError && <Alert color="red" title="Unable to save" mb="md">{saveError}</Alert>}
                    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
                    </fieldset>
                </Box>
            </Modal>
        );
    }
};
