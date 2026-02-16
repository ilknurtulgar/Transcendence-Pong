export interface IPage{
    render(): string;
    mount() : void | Promise<void>;
    unmount() : void;
}