import React, {useEffect} from "react";
import {IBrowserStyles} from "../../../stores/browserStore";
import {view} from "@risingstack/react-easy-state";

enum CanvasBackgroundTypes {
    Image = 'Image',
    Solid = 'Solid',
    Gradient = 'Gradient',
    None = 'None',
}

enum ScreenshotType {
    Browser = 'Browser',
    Device = 'Device',
    None = 'None',
    Twitter = 'Twitter',
    Code = 'Code',
}

export interface ICanvasProps {
    showControlsOnly?: boolean;
    imageData?: string;
    canvasBgColor?: string;
    canvasBgImage?: string;
    canvasBgType?: CanvasBackgroundTypes;
    canvasVerticalPadding?: number;
    canvasHorizontalPadding?: number;
    styles: IBrowserStyles;
    isDownloadMode: boolean;
    isAutoRotateActive: boolean;
    frameType?: ScreenshotType;
    hideAddressBarOverride?: boolean;
    borderRadius: number;
}

const Canvas = view((props: ICanvasProps) => {
    const scaleCanvasOnWindowResize = () => {
        const canvas = document.querySelector<HTMLElement>('.canvas');
        const mainContent = document.querySelector<HTMLElement>('.main-content');
        const maxWidth = mainContent.offsetWidth;
        const maxHeight = window.innerHeight;
        const height = canvas.clientHeight;
        const width = canvas.clientWidth;
        const minScale = .35;
        const maxScale = 1;
        const scale = Math.min(Math.max(Math.min(maxWidth / width, maxHeight / height), minScale), maxScale) * .75;

        canvas.style.transform = 'scale(' + scale + ')';
    };

    useEffect(() => {
        window.addEventListener('resize', scaleCanvasOnWindowResize);
        scaleCanvasOnWindowResize()
        return () => {
            window.removeEventListener('resize', scaleCanvasOnWindowResize);
        }
    });

    return (
        <div className="canvas" id="canvas">
        </div>
    );
});