import { useState, useRef, ChangeEvent } from 'react';
import {
    Box,
    Button,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import SignaturePad from 'react-signature-canvas';
import { SelectChangeEvent } from '@mui/material/Select';

const VenueNumbersList = () => {
    const [venueName, setVenueName] = useState<string>('');
    const [numPeople, setNumPeople] = useState<string>('');
    const [showSignaturePad, setShowSignaturePad] = useState<boolean>(false);
    const [isSignatureDrawn, setIsSignatureDrawn] = useState<boolean>(false);
    const signaturePadRef = useRef<SignaturePad | null>(null);

    const clearSignature = () => {
        if (signaturePadRef.current) {
            signaturePadRef.current.clear();
        }
    };

    const handleVenueNameChange = (event: SelectChangeEvent<string>) => {
        setVenueName(event.target.value);
    };

    const handleNumPeopleChange = (event: ChangeEvent<HTMLInputElement>) => {
        setNumPeople(event.target.value);
    };

    const handleClearSignature = () => {
        clearSignature();
        setIsSignatureDrawn(false);
    };

    const handleSaveSignature = () => {
        // Implement save signature logic here
        setIsSignatureDrawn(true); // For demonstration purpose
    };

    const handleAddSignature = () => {
        setShowSignaturePad(true);
    };

    return (
        <Box>
            <Box mt={2}>
                <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id="venue-name-label">Venue</InputLabel>
                    <Select
                        labelId="venue-name-label"
                        id="venue-name-select"
                        value={venueName}
                        onChange={handleVenueNameChange}
                        label="Venue"
                    >
                        <MenuItem value="Huki Muki">Huki Muki</MenuItem>
                        <MenuItem value="Let's Sing Karaoke Bar">Let's Sing Karaoke Bar</MenuItem>
                        <MenuItem value="Rin Music">Rin Music</MenuItem>
                        <MenuItem value="Four Music Club">Four Music Club</MenuItem>
                        <MenuItem value="Frantic Club">Frantic Club</MenuItem>
                        <MenuItem value="Prozak 2.0">Prozak 2.0</MenuItem>
                        <MenuItem value="Choice Club">Choice Club</MenuItem>
                        <MenuItem value="Coco Music Club">Coco Music Club</MenuItem>
                        <MenuItem value="Bracka 4">Bracka 4</MenuItem>
                        <MenuItem value="Szpitalna 1">Szpitalna 1</MenuItem>
                        <MenuItem value="Diva Club">Diva Club</MenuItem>
                    </Select>
                </FormControl>
                <TextField
                    fullWidth
                    id="num-people"
                    label="Number of People"
                    type="number"
                    value={numPeople}
                    onChange={handleNumPeopleChange}
                    sx={{ mb: 2 }}
                />
                <Button
                    variant="contained"
                    onClick={handleAddSignature}
                    disabled={!venueName || !numPeople || isSignatureDrawn}
                >
                    Add Signature
                </Button>
            </Box>
            {showSignaturePad && (
                <Box mt={4}>
                    <Typography variant="h6">Signature</Typography>
                    <Divider />
                    <Box mt={2}>
                        <SignaturePad ref={signaturePadRef} canvasProps={{ style: { border: "1px solid #000" }}}/>
                        <Box mt={2}>
                            <Button variant="outlined" onClick={handleClearSignature} sx={{ mr: 2 }}>
                                Clear
                            </Button>
                            <Button variant="contained" onClick={handleSaveSignature}>
                                Save
                            </Button>
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export default VenueNumbersList;
