import { useEffect, useMemo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import Table from '../../utils/Table';
import { modifyColumn } from '../../utils/modifyColumn';
import { reviewPlatformColumnDef } from './reviewPlatformColumnDef';
import {
  fetchReviewPlatforms,
  createReviewPlatform,
  updateReviewPlatform,
  deleteReviewPlatform,
} from '../../actions/reviewPlatformActions';
import type { ReviewPlatform } from '../../types/reviewPlatforms/ReviewPlatform';
import type { MRT_ColumnDef } from 'mantine-react-table';
import type { ServerResponse } from '../../types/general/ServerResponse';

const MODULE_SLUG = 'review-platform-management';

const ReviewPlatformList = () => {
  const dispatch = useAppDispatch();
  const platformState = useAppSelector((state) => state.reviewPlatforms)[0];

  useEffect(() => {
    dispatch(fetchReviewPlatforms());
  }, [dispatch]);

  const data = useMemo(() => {
    const serverData = (platformState.data as ServerResponse<ReviewPlatform>)[0]?.data ?? [];
    return serverData;
  }, [platformState.data]);

  const columns = useMemo(() => {
    const baseColumns = (platformState.data as ServerResponse<ReviewPlatform>)[0]?.columns as
      | MRT_ColumnDef<Partial<ReviewPlatform>>[]
      | undefined;
    return modifyColumn(baseColumns ?? [], reviewPlatformColumnDef());
  }, [platformState.data]);

  const normalizePayload = (values: Partial<ReviewPlatform>) => {
    const next: Partial<ReviewPlatform> = { ...values };
    if (next.isActive !== undefined) {
      if (typeof next.isActive === 'string') {
        next.isActive = next.isActive !== 'false';
      } else {
        next.isActive = Boolean(next.isActive);
      }
    }
    return next;
  };

  const handleCreate = useCallback(
    async (values: Partial<ReviewPlatform>) => {
      await dispatch(createReviewPlatform(normalizePayload(values))).unwrap();
      await dispatch(fetchReviewPlatforms());
    },
    [dispatch],
  );

  const handleUpdate = useCallback(
    async (original: Partial<ReviewPlatform>, values: Partial<ReviewPlatform>) => {
      const id = Number(original.id ?? values.id);
      if (!Number.isFinite(id) || id <= 0) {
        return;
      }
      await dispatch(updateReviewPlatform({ platformId: id, payload: normalizePayload(values) })).unwrap();
      await dispatch(fetchReviewPlatforms());
    },
    [dispatch],
  );

  const handleDelete = useCallback(
    async (record: Partial<ReviewPlatform>) => {
      const id = Number(record.id);
      if (!Number.isFinite(id) || id <= 0) {
        return;
      }
      await dispatch(deleteReviewPlatform(id)).unwrap();
      await dispatch(fetchReviewPlatforms());
    },
    [dispatch],
  );

  const initialState = useMemo(
    () => ({
      showGlobalFilter: true,
      columnVisibility: {
        id: false,
      },
    }),
    [],
  );

  return (
    <Table
      pageTitle="Review Platforms"
      data={data}
      loading={platformState.loading}
      error={platformState.error}
      columns={columns}
      actions={{ handleCreate, handleUpdate, handleDelete }}
      initialState={initialState}
      moduleSlug={MODULE_SLUG}
    />
  );
};

export default ReviewPlatformList;
