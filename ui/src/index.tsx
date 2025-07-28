import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import './index.css';
import App from './App';
import { store } from './store/store'; // Import your Redux store
import reportWebVitals from './reportWebVitals';
import 'mdb-react-ui-kit/dist/css/mdb.min.css';
import "@fortawesome/fontawesome-free/css/all.min.css";
import '@mantine/core/styles.css'; //import Mantine V7 styles needed by MRT
import '@mantine/dates/styles.css'; //if using mantine component features
import 'mantine-react-table/styles.css'; //import MRT styles
import { MantineProvider } from '@mantine/core';
import type { MantineTheme } from '@mantine/core';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <Provider store={store}>
    <MantineProvider theme={{
      fontFamily: 'Open Sans, sans-serif',
      fontFamilyMonospace: 'Fira Code, monospace',
      headings: { fontFamily: 'Roboto Slab, serif' },
      components: {
        NavLink: {
          styles: (theme: MantineTheme, props: any) => ({
            root: {
              borderRadius: 8,
              height: 36,
              paddingLeft: 6,
              alignItems: "center",
              cursor: "pointer",
              letterSpacing: 0.1,
              transition: "background 0.14s, color 0.14s",
              fontWeight: 900,
              // Hover effect (pseudo-class is not possible inline, so use CSS variable below!)
            },
            label: {
              color: props.active ? "#0a6ece" : "#23292f",
              fontWeight: 900,
            },
          }),
          vars: (theme: MantineTheme, props: any) => ({
            root: {
              "--nl-hover": props.active ? "#cce6ff" : "#e3e3e3",
              "--nl-bg": props.active ? "#cce6ff" : "transparent",
              "--nl-color": props.active ? "#0a6ece" : "#23292f",
            },
          }),
        },
        Drawer: {
          vars: (theme: MantineTheme, props: any) => ({
            root: {
              "--drawer-height": "100%",
            },
          }),
        },
      },
    }}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <App />
      </LocalizationProvider>
    </MantineProvider>
  </Provider>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
