import React, { ChangeEvent } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Container, Group } from '@mantine/core';
import { IconUser, IconLock } from '@tabler/icons-react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setPasswordState, setUserState } from '../actions/sessionActions';
import { loginUser } from '../actions/userActions';

const LoginPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const { user, password } = useAppSelector((state) => state.session);

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        const data = await dispatch(loginUser({email:user, password:password}));
    };

    return (
        <Container size={420} my={40}>
            <Paper radius={12} p="xl" withBorder style={{ textAlign: 'center' }}>
                <Title order={2} mb="lg">
                    Login
                </Title>

                <form onSubmit={handleLogin}>
                    <TextInput
                        label="Username or Email"
                        placeholder="Username or Email"
                        value={user}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setUserState(event.target.value))}
                        leftSection={<IconUser />}
                        required
                    />

                    <PasswordInput
                        label="Password"
                        placeholder="Password"
                        value={password}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch(setPasswordState(event.target.value))}
                        leftSection={<IconLock />}
                        required
                        mt="md"
                    />

                    <Group mt="xl" style={{ justifyContent: 'flex-end' }}>
                        <Button type="submit">Login</Button>
                    </Group>
                </form>
            </Paper>
        </Container>
    );
};

export default LoginPage;
