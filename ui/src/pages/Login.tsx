import React, { ChangeEvent, useState } from 'react';
import {
    TextInput,
    PasswordInput,
    Button,
    Paper,
    Title,
    Container,
    Avatar,
    Center,
} from '@mantine/core';
import { IconUser, IconLock, IconCheck, IconX } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setUserState } from '../actions/sessionActions';
import { loginUser, createUser } from '../actions/userActions';

const LoginPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const { user } = useAppSelector((state) => state.session);
    const [isSignup, setIsSignup] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [passwordsMatch, setPasswordsMatch] = useState(true); // Track if passwords match

    // Password verification rules
    const rules = [
        { regex: /(?=.*[0-9])/, description: 'At least one digit' },
        { regex: /(?=.*[a-z])/, description: 'At least one lowercase letter' },
        { regex: /(?=.*[A-Z])/, description: 'At least one uppercase letter' },
        { regex: /(?=.*[*.!@$%^&(){}[\]:;<>,.?/~_+-=|\\])/, description: 'At least one special character' },
        { regex: /.{8,32}/, description: 'Must be 8-32 characters long' }
    ];

    const PasswordRule: React.FC<{ rule: { regex: RegExp; description: string }; isValid: boolean }> = ({ rule, isValid }) => {
        return (
            <div style={{ display: 'flex', alignItems: 'center' }}>
                {isValid ? <IconCheck color="green" /> : <IconX color="red" />}
                <span style={{ fontSize: '0.9rem', marginLeft: '4px' }}>{rule.description}</span>
            </div>
        );
    };

    const handleToggleMode = () => {
        setIsSignup(!isSignup);
    };

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        // Assuming your loginUser action creator expects an object with email and password
        await dispatch(loginUser({ email: user, password }));
    };

    const handleSignUp = async (event: React.FormEvent) => {
        event.preventDefault();
        // Assuming your loginUser action creator expects an object with email and password
        await dispatch(createUser({ email, password, username:user, firstName, lastName }));
        handleToggleMode();
    };

    const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
        setPassword(event.target.value);
        // Verify if passwords match when password changes
        setPasswordsMatch(event.target.value === confirmPassword);
    };

    const handleConfirmPasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
        setConfirmPassword(event.target.value);
        // Verify if passwords match when confirm password changes
        setPasswordsMatch(event.target.value === password);
    };

    const isPasswordValid = (password: string) => {
        return rules.every(rule => rule.regex.test(password));
    };

    return (
        <Container size={420} my={40} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
            <Paper radius={12} p="xl" withBorder style={{ width: 340, textAlign: 'center' }}>
                <Center>
                    <Avatar variant="filled" radius="xl" size="xl" color="#4088F6" src="" />
                </Center>
                <Title order={2} style={{ marginBottom: 20, paddingTop: 30 }}>
                    {isSignup ? 'Sign Up' : 'Sign In'}
                </Title>
                <form onSubmit={isSignup ? handleSignUp : handleLogin} style={{ textAlign: 'left' }}>
                    <TextInput
                        label="Username or Email"
                        placeholder="Username or Email"
                        value={user}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
                        leftSection={<IconUser />}
                        required
                    />
                    {isSignup && (
                        <TextInput
                            label="Email"
                            placeholder="Email"
                            value={email}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
                            mt="md"
                            required
                        />
                    )}
                    {isSignup && (
                        <TextInput
                            label="First Name"
                            placeholder="First Name"
                            value={firstName}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setFirstName(event.target.value)}
                            mt="md"
                            required
                        />
                    )}
                    {isSignup && (
                        <TextInput
                            label="Last Name"
                            placeholder="Last Name"
                            value={lastName}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)}
                            mt="md"
                            required
                        />
                    )}
                    <PasswordInput
                        label="Password"
                        placeholder="Password"
                        value={password}
                        onChange={handlePasswordChange} // Pass the handler for password change
                        leftSection={<IconLock />}
                        required
                        mt="md"
                        mb="md"
                    />
                    {isSignup && (
                        rules.map((rule, index) => (
                            <PasswordRule key={index} rule={rule} isValid={rule.regex.test(password)} />
                        ))
                    )}
                    {isSignup && (
                        <PasswordInput
                            label="Confirm Password"
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={handleConfirmPasswordChange} // Pass the handler for confirm password change
                            leftSection={<IconLock />}
                            required
                            mt="md"
                        />
                    )}
                    {/* Error message for password mismatch */}
                    {isSignup && !passwordsMatch && (
                        <div style={{ color: 'red', marginTop: 4 }}>Passwords do not match</div>
                    )}
                    <Button fullWidth mt="xl" type="submit" disabled={(!passwordsMatch || !isPasswordValid(password)) && isSignup || password === "" || user === ""}> {/* Disable button if passwords don't match */}
                        {isSignup ? 'Sign Up' : 'Login'}
                    </Button>
                </form>
                {/* Toggle between login and signup mode */}
                <Button variant="link" onClick={handleToggleMode} mt="md">
                    {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
                </Button>
            </Paper>
        </Container>
    );
};

export default LoginPage;
