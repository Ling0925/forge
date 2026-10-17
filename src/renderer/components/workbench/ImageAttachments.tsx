import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "../primitives/Button";
import { Dialog } from "./Dialog";
import type { ImageAttachment } from "../../../shared/images";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  imageAttachmentSchema,
} from "../../../shared/images";
import "./image-attachments.css";

const EMPTY_IMAGES: readonly ImageAttachment[] = [];

export interface UseImageAttachmentsResult {
  readonly images: readonly ImageAttachment[];
  readonly reading: boolean;
  readonly error: string;
  readonly addFiles: (files: readonly File[]) => Promise<void>;
  readonly removeImage: (index: number) => void;
  readonly clearImages: (
    captured: readonly ImageAttachment[],
    targetDraftId?: string
  ) => void;
}

export function useImageAttachments(draftId: string): UseImageAttachmentsResult {
  const isReadingRef = useRef<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [draftImages, setDraftImages] = useState<
    Readonly<Record<string, readonly ImageAttachment[]>>
  >({});
  const [draftErrors, setDraftErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [readingDrafts, setReadingDrafts] = useState<
    Readonly<Record<string, boolean>>
  >({});

  const draftImagesRef = useRef(draftImages);
  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (!files || files.length === 0) return;

      const targetDraftId = draftId;
      if (isReadingRef.current[targetDraftId]) {
        if (mountedRef.current) {
          setDraftErrors(prev => ({
            ...prev,
            [targetDraftId]: "正在读取图片，请稍候…",
          }));
        }
        return;
      }
      const currentImages = draftImagesRef.current[targetDraftId] ?? EMPTY_IMAGES;

      if (currentImages.length + files.length > MAX_IMAGES) {
        if (mountedRef.current) {
          setDraftErrors(prev => ({
            ...prev,
            [targetDraftId]: `图片数量超出限制，每条消息最多支持 ${MAX_IMAGES} 张图片（当前已有 ${currentImages.length} 张）。`,
          }));
        }
        return;
      }

      for (const file of files) {
        if (file.size > MAX_IMAGE_BYTES) {
          if (mountedRef.current) {
            setDraftErrors(prev => ({
              ...prev,
              [targetDraftId]: `图片 "${file.name}" 大小超出限制，单张图片不能超过 2 MiB。`,
            }));
          }
          return;
        }

        const lowerName = file.name.toLowerCase();
        const type = file.type.toLowerCase();
        const isSupportedMime = [
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
        ].includes(type);
        const isSupportedExt = /\.(png|jpe?g|webp|gif)$/.test(lowerName);

        if (!isSupportedMime && !isSupportedExt) {
          if (mountedRef.current) {
            setDraftErrors(prev => ({
              ...prev,
              [targetDraftId]: `文件 "${file.name}" 不是支持的图片格式，仅支持 PNG、JPEG、WebP、GIF。`,
            }));
          }
          return;
        }
      }

      isReadingRef.current = { ...isReadingRef.current, [targetDraftId]: true };
      if (mountedRef.current) {
        setReadingDrafts(prev => ({ ...prev, [targetDraftId]: true }));
      }

      try {
        const newAttachments: ImageAttachment[] = [];

        for (const file of files) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                resolve(reader.result);
              } else {
                reject(new Error(`读取图片 "${file.name}" 失败。`));
              }
            };
            reader.onerror = () => {
              reject(new Error(`读取图片 "${file.name}" 失败。`));
            };
            reader.onabort = () => {
              reject(new Error(`读取图片 "${file.name}" 被中止。`));
            };
            reader.readAsDataURL(file);
          });

          const parseResult = imageAttachmentSchema.safeParse({
            name: file.name,
            dataUrl,
          });

          if (!parseResult.success) {
            throw new Error(
              `图片 "${file.name}" 格式无效，仅支持 PNG、JPEG、WebP、GIF 且不超过 2 MiB。`
            );
          }

          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const width = img.naturalWidth || img.width;
              const height = img.naturalHeight || img.height;
              if (width * height > 40_000_000) {
                reject(
                  new Error(`图片 "${file.name}" 分辨率过大（超过 4000 万像素）。`)
                );
                return;
              }
              resolve();
            };
            img.onerror = () => {
              reject(new Error(`图片 "${file.name}" 损坏或无法解析。`));
            };
            img.src = dataUrl;
          });

          newAttachments.push(parseResult.data);
        }

        if (mountedRef.current) {
          setDraftImages(prev => {
            const current = prev[targetDraftId] ?? EMPTY_IMAGES;
            const nextList = [...current, ...newAttachments];
            draftImagesRef.current = {
              ...draftImagesRef.current,
              [targetDraftId]: nextList,
            };
            return {
              ...prev,
              [targetDraftId]: nextList,
            };
          });
          setDraftErrors(prev => ({
            ...prev,
            [targetDraftId]: "",
          }));
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          const message =
            err instanceof Error ? err.message : "读取图片失败。";
          setDraftErrors(prev => ({
            ...prev,
            [targetDraftId]: message,
          }));
        }
      } finally {
        isReadingRef.current = { ...isReadingRef.current, [targetDraftId]: false };
        if (mountedRef.current) {
          setReadingDrafts(prev => ({ ...prev, [targetDraftId]: false }));
        }
      }
    },
    [draftId]
  );

  const removeImage = useCallback(
    (index: number) => {
      setDraftImages(prev => {
        const current = prev[draftId];
        if (!current || index < 0 || index >= current.length) return prev;
        const next = [...current];
        next.splice(index, 1);
        draftImagesRef.current = {
          ...draftImagesRef.current,
          [draftId]: next,
        };
        return {
          ...prev,
          [draftId]: next,
        };
      });
      setDraftErrors(prev => {
        if (!prev[draftId]) return prev;
        return {
          ...prev,
          [draftId]: "",
        };
      });
    },
    [draftId]
  );

  const clearImages = useCallback(
    (captured: readonly ImageAttachment[], targetDraftId?: string) => {
      if (!captured || captured.length === 0) return;
      const target = targetDraftId ?? draftId;
      setDraftImages(prev => {
        const current = prev[target];
        if (!current || current.length === 0) return prev;
        const capturedSet = new Set(captured);
        const next = current.filter(item => !capturedSet.has(item));
        if (next.length === current.length) return prev;
        draftImagesRef.current = {
          ...draftImagesRef.current,
          [target]: next,
        };
        return {
          ...prev,
          [target]: next,
        };
      });
    },
    [draftId]
  );

  return {
    images: draftImages[draftId] ?? EMPTY_IMAGES,
    reading: readingDrafts[draftId] ?? false,
    error: draftErrors[draftId] ?? "",
    addFiles,
    removeImage,
    clearImages,
  };
}

export interface ImageAttachmentsProps {
  readonly images: readonly ImageAttachment[];
  readonly reading?: boolean;
  readonly onRemove?: (index: number) => void;
  readonly className?: string;
}

export function ImageAttachments({
  images,
  reading = false,
  onRemove,
  className = "",
}: ImageAttachmentsProps) {
  const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null);

  if (images.length === 0 && !reading) {
    return null;
  }

  const baseClass = onRemove
    ? "composer-image-attachments"
    : "message-image-attachments";
  const rootClassName = className ? `${baseClass} ${className}` : baseClass;

  return (
    <>
      <section className={rootClassName} aria-label="图片附件">
      {images.map((img, index) => {
        const isInteractive = typeof onRemove === "function";
        return (
          <div key={`${img.name}-${index}`} className="image-attachment-item">
            {isInteractive ? (
              <div className="image-attachment-thumb-wrap">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="image-attachment-img"
                  loading="lazy"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="image-attachment-remove"
                  onClick={() => onRemove(index)}
                  aria-label={`删除图片 ${img.name}`}
                  title={`删除图片 ${img.name}`}
                  icon={<X size={16} />}
                />
              </div>
            ) : (
              <button
                type="button"
                className="image-attachment-thumb-wrap image-attachment-button"
                onClick={() => setPreviewImage(img)}
                aria-label={`查看图片：${img.name}`}
                title={`查看图片：${img.name}`}
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="image-attachment-img"
                  loading="lazy"
                />
              </button>
            )}
            <span className="image-attachment-name" title={img.name}>
              {img.name}
            </span>
          </div>
        );
      })}
      {reading && (
        <div
          className="image-attachment-item image-attachment-loading-item"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="image-attachment-thumb-wrap image-attachment-loading">
            <span className="image-attachment-spinner" aria-hidden="true" />
          </div>
          <span className="image-attachment-name image-attachment-loading-text">
            正在读取…
          </span>
        </div>
      )}
      </section>
      {previewImage && (
        <Dialog
          title={previewImage.name}
          kicker="图片预览"
          open={true}
          onClose={() => setPreviewImage(null)}
        >
          <div className="image-attachment-dialog-body">
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="image-attachment-dialog-img"
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
