import React, { ChangeEvent } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Group, Checkbox, Anchor, Avatar, Center } from '@mantine/core';
import { IconUser, IconLock } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setPasswordState, setUserState } from '../actions/sessionActions';
import { loginUser } from '../actions/userActions';

const LoginPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const { user, password } = useAppSelector((state) => state.session);

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        // Assuming your loginUser action creator expects an object with email and password
        await dispatch(loginUser({ email: /*user*/ 'rob@t5social.com', password: /*password*/ '12341234' }));
    };

    return (
        <Container size={420} my={40} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
            <Paper radius={12} p="xl" withBorder style={{ width: 340, textAlign: 'center' }}>
                <Center>
                    <Avatar variant="filled" radius="xl" size="xl" color="#4088F6" src="" />
                </Center>
                <Title order={2} style={{ marginBottom: 20, paddingTop: 30 }}>
                    Sign In
                </Title>
                <form onSubmit={handleLogin} style={{ textAlign: 'left' }}>
                    <TextInput
                        label="Username"
                        placeholder="Username"
                        value={user}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
                        leftSection={<IconUser />}
                        //required
                    />
                    <PasswordInput
                        label="Password"
                        placeholder="Password"
                        value={password}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setPasswordState(event.target.value))}
                        leftSection={<IconLock />}
                        //required
                        mt="md"
                    />
                    <Group mt="md">
                        <Checkbox label="Remember Me" />
                        <Anchor href="#" size="sm" onClick={(event) => event.preventDefault()}>Forgot Password?</Anchor>
                    </Group>
                    <Button fullWidth mt="xl" type="submit">
                        Login
                    </Button>
                </form>
            </Paper>
        </Container>
    );
};

export default LoginPage;
