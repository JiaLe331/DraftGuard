"""Bound file bytes in multipart callbacks, before writing them to temporary storage."""

from python_multipart.exceptions import MultipartParseError
from starlette.formparsers import MultiPartException, MultiPartParser

from .dataset import DatasetError


class LimitedUploadParser(MultiPartParser):
    def __init__(self, request, file_limit: int, *, max_fields: int = 1):
        super().__init__(
            request.headers,
            request.stream(),
            max_files=1,
            max_fields=max_fields,
            max_part_size=1024,
        )
        self.file_limit = file_limit
        self.file_bytes = 0
        self.finished = False

    def on_part_data(self, data: bytes, start: int, end: int):
        if self._current_part.file is not None:
            self.file_bytes += end - start
            if self.file_bytes > self.file_limit:
                raise DatasetError(
                    "FILE_TOO_LARGE", "The file exceeds the development upload limit.", 413
                )
        super().on_part_data(data, start, end)

    def on_end(self):
        self.finished = True

    async def parse(self):
        try:
            form = await super().parse()
            if not self.finished:
                await form.close()
                for file in self._files_to_close_on_error:
                    file.close()
                raise DatasetError(
                    "INVALID_MULTIPART", "The upload ended before it was complete.", 400
                )
            return form
        except (MultiPartException, MultipartParseError) as exc:
            raise DatasetError(
                "INVALID_MULTIPART", "The upload form could not be read.", 400
            ) from exc
