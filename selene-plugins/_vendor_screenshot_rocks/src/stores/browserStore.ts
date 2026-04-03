import {store} from '@risingstack/react-easy-state';
import {observe} from "@nx-js/observer-util";

enum BrowserThemes {
    Default,
    Dark,
    Square,
    Darker,
    Rounder,
    Weird,
    Custom,
}

enum BackgroundType {
    Image,
    Color,
}

const browserThemes = {
    [BrowserThemes.Default]: {
        browserChromeBgColor: '#e6ecefcf',
        browserControlsBgColor: '#ffffffa8',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#FF8585',
        minimizeButtonColor: '#FFD071',
        maximizeButtonColor: '#74ED94',
        browserBorderRadius: 10,
        controlsBorderRadius: 3,
        controlsHeight: 30,
        chromeHeight: 50,
    },
    [BrowserThemes.Darker]: {
        browserChromeBgColor: '#000000',
        browserControlsBgColor: '#1f1c1c',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#201d1d',
        minimizeButtonColor: '#201d1d',
        maximizeButtonColor: '#201d1d',
        browserBorderRadius: 10,
        controlsBorderRadius: 3,
        controlsHeight: 30,
        chromeHeight: 50,
    },
    [BrowserThemes.Dark]: {
        browserChromeBgColor: '#2d373b',
        browserControlsBgColor: '#ffffff',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#FF8585',
        minimizeButtonColor: '#FFD071',
        maximizeButtonColor: '#74ED94',
        browserBorderRadius: 10,
        controlsBorderRadius: 3,
        controlsHeight: 30,
        chromeHeight: 50,
    },
    [BrowserThemes.Square]: {
        browserChromeBgColor: '#E6ECEF',
        browserControlsBgColor: '#ffffff',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#FF8585',
        minimizeButtonColor: '#FFD071',
        maximizeButtonColor: '#74ED94',
        browserBorderRadius: 0,
        controlsBorderRadius: 0,
        controlsHeight: 30,
        chromeHeight: 50,
    },
    [BrowserThemes.Rounder]: {
        browserChromeBgColor: '#ffffff',
        browserControlsBgColor: '#ffffff',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#FF8585',
        minimizeButtonColor: '#FFD071',
        maximizeButtonColor: '#74ED94',
        browserBorderRadius: 10,
        controlsBorderRadius: 10,
        controlsHeight: 30,
        chromeHeight: 60,
    },
    [BrowserThemes.Weird]: {
        browserChromeBgColor: '#550E40',
        browserControlsBgColor: '#822063',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#822163',
        minimizeButtonColor: '#822163',
        maximizeButtonColor: '#822163',
        browserBorderRadius: 1,
        controlsBorderRadius: 4,
        controlsHeight: 30,
        chromeHeight: 60,
    },
};

enum ImageFormats {
    PNG = 'png',
    JPEG = 'jpeg',
    SVG = 'svg',
}

export interface IBrowserStyles {
    browserChromeBgColor: string;
    browserControlsBgColor: string;
    browserControlsTextColor: string;
    closeButtonColor: string;
    minimizeButtonColor: string;
    maximizeButtonColor: string;
    browserBorderRadius: number;
    controlsBorderRadius: number;
    controlsHeight: number;
    chromeHeight: number;
}

export interface IBrowserSettings {
    activeTheme: BrowserThemes;
    backgroundType: BackgroundType;
    showWindowControls: boolean;
    showAddressBar: boolean;
    showAddressBarUrl: boolean;
    addressBarUrlProtocol: string;
    addressBarUrl: string;
    showNavigationButtons: boolean;
    showSettingsButton: boolean;
    reduceImageQualityOnUpload: boolean;
}

export interface IBrowserStore {
    settings: IBrowserSettings,
    customStyles?: IBrowserStyles;
    styles: IBrowserStyles;
    defaultImageFormat: ImageFormats;

    setImageData(imageData: string): void,

    setBrowserTheme(browserTheme: BrowserThemes): void,
}

let browserStore = store({
    setBrowserTheme(browserTheme: BrowserThemes) {
        browserStore.settings.activeTheme = browserTheme;
    },

    get styles(): IBrowserStyles {
        if (browserStore.settings.activeTheme === BrowserThemes.Custom) {
            return browserStore.customStyles;
        }

        return (browserThemes as any)[browserStore.settings.activeTheme];
    },

    customStyles: {
        browserChromeBgColor: '#ffffff',
        browserControlsBgColor: '#dddddd',
        browserControlsTextColor: '#b5b5b5',
        closeButtonColor: '#FF8585',
        minimizeButtonColor: '#FFD071',
        maximizeButtonColor: '#74ED94',
        browserBorderRadius: 10,
        controlsBorderRadius: 10,
        controlsHeight: 30,
        chromeHeight: 60,
    },

    settings: {
        activeTheme: BrowserThemes.Default,
        backgroundType: BackgroundType.Color,
        reduceImageQualityOnUpload: false,
        showWindowControls: true,
        showAddressBar: true,
        showAddressBarUrl: true,
        addressBarUrlProtocol: 'https://',
        addressBarUrl: 'edit-me.com',
        showNavigationButtons: true,
        showSettingsButton: true,
    }
} as IBrowserStore);

if (localStorage.getItem('browserStoreSettings')) {
    const localStore = JSON.parse(localStorage.getItem('browserStoreSettings'));
    browserStore.settings = localStore.settings;
    browserStore.customStyles = localStore.styles;
}

observe(() => {
    localStorage.setItem('browserStoreSettings', JSON.stringify({
        settings: browserStore.settings,
        styles: browserStore.styles,
    }))
});